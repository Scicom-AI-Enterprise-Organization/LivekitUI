import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { ensureDb } from "@/lib/db";
import { deploySandbox, stopSandbox, isRunning, deleteSandboxDir } from "@/lib/sandbox";
import {
  ASSIST_TEMPLATE,
  assistWorkerName,
  deployAssistWorker,
  normalizeAssistConfig,
} from "@/lib/agent-assist";
import {
  ASSIST_DUAL_TEMPLATE,
  deployDualWorker,
  dualWorkerName,
  normalizeDualConfig,
} from "@/lib/agent-assist-dual";
import { deleteAgentFiles, stopAgent } from "@/lib/agent-runner";
import { sameSandboxName, validateSandboxName } from "@/lib/sandbox-name";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const apps = await db.getAllSandboxApps();

  const result = apps.map((a) => ({
    id: a.id,
    name: a.name,
    template: a.template,
    url: a.url,
    status: isRunning(a.name) ? "running" : "stopped",
    createdAt: a.created_at,
  }));

  return NextResponse.json({ apps: result });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json();
  const { template, agentName, deployAssist, assist } = body;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name || !template) {
    return NextResponse.json({ error: "Name and template are required" }, { status: 400 });
  }

  const nameProblem = validateSandboxName(name);
  if (nameProblem) {
    return NextResponse.json({ error: nameProblem }, { status: 400 });
  }

  // Checked here rather than left to the database's unique index, because
  // `deploySandbox` runs first: a duplicate name reaching it would overwrite the
  // existing sandbox's files from the template and start a second dev server for
  // it, and the only thing the user would see is the driver's own
  // "UNIQUE constraint failed: sandbox_apps.name".
  const db = await ensureDb();
  const taken = (await db.getAllSandboxApps()).find((a) => sameSandboxName(a.name, name));
  if (taken) {
    return NextResponse.json(
      {
        error: `A sandbox named "${taken.name}" already exists. Pick a different name, or delete that one from the Sandboxes list first.`,
      },
      { status: 409 }
    );
  }

  // Either assist sandbox can bring its own worker: a transcriber that listens to
  // two people is a different shape of agent than the builder emits, so there is
  // nothing to pick from the dispatch list until one exists. Its name is derived
  // from the sandbox, which is why the sandbox can be told what to dispatch before
  // the worker is actually up — and why a failed worker deploy does not have to
  // undo the sandbox.
  //
  // The two differ only in which module deploys them and which config validates:
  // `agent-assist` binds a session per *participant*, `agent-assist-dual` binds one
  // per *track* on a single participant. Both store the result under `assist` /
  // `assistWorker`, so the edit dialog and the delete path need no branch — but the
  // redeploy scans in each module are template-filtered, or one would write the
  // other's environment.
  const isAssist = template === ASSIST_TEMPLATE;
  const isDual = template === ASSIST_DUAL_TEMPLATE;
  const wantsWorker = (isAssist || isDual) && deployAssist !== false;
  const assistConfig = isDual
    ? normalizeDualConfig(assist)
    : isAssist
      ? normalizeAssistConfig(assist)
      : null;
  const dispatchName: string = wantsWorker
    ? isDual
      ? dualWorkerName(name)
      : assistWorkerName(name)
    : agentName || "";

  try {
    const { url, port } = await deploySandbox(
      name,
      template,
      process.env.LIVEKIT_API_KEY || "",
      process.env.LIVEKIT_API_SECRET || "",
      getRuntimeConfig().sandboxDomain,
      dispatchName
    );

    const app = await db.createSandboxApp(name, template, url, port);

    // Only now that the sandbox exists: starting the worker first would leak a
    // running Python process if the name turned out to be taken.
    let workerError: string | null = null;
    if (wantsWorker && assistConfig) {
      try {
        const deployer = {
          email: session.email,
          name: `${session.firstName} ${session.lastName}`.trim() || session.email,
        };
        if (isDual) {
          await deployDualWorker(name, normalizeDualConfig(assistConfig), deployer);
        } else {
          await deployAssistWorker(name, assistConfig, deployer);
        }
      } catch (err) {
        // The sandbox is still worth having — two people can talk in it, and the
        // worker can be redeployed once the cause (usually a missing Python venv)
        // is fixed. Report it instead of failing the whole create.
        workerError = err instanceof Error ? err.message : String(err);
      }
    }

    const settings: Record<string, unknown> = {};
    if (dispatchName) {
      settings.agentDispatch = dispatchName;
      settings.agentName = dispatchName;
    }
    if (assistConfig) {
      settings.assist = assistConfig;
      // Which worker this sandbox owns, and is therefore allowed to stop when it
      // is deleted. Blank means it is dispatching someone else's agent.
      settings.assistWorker = wantsWorker && !workerError ? dispatchName : "";
    }
    if (Object.keys(settings).length > 0) {
      await db.updateSandboxAppSettings(app.id, JSON.stringify(settings));
    }

    return NextResponse.json({
      app: {
        id: app.id,
        name: app.name,
        template: app.template,
        url: app.url,
        status: "running",
        createdAt: app.created_at,
        port,
      },
      assistWorker: wantsWorker ? { name: dispatchName, error: workerError } : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Backstop for two requests racing past the check above. Each driver words a
    // unique violation its own way and neither says "already exists", which is
    // why this used to hand the user
    // `UNIQUE constraint failed: sandbox_apps.name` verbatim.
    const duplicate =
      /unique constraint failed/i.test(message) || // SQLite
      /duplicate key value|violates unique constraint/i.test(message) || // Postgres
      /already exists/i.test(message);
    if (duplicate) {
      return NextResponse.json(
        {
          error: `A sandbox named "${name}" already exists. Pick a different name, or delete that one from the Sandboxes list first.`,
        },
        { status: 409 }
      );
    }

    // A template that was never cloned into example/ is the other common failure,
    // and `deploySandbox` already explains that one properly.
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role === "member") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id, name } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // A worker this sandbox created has no other owner, so it goes too — otherwise
  // deleting the sandbox leaves a Python process registered for a dispatch name
  // nothing will ever request again. A worker the user merely *pointed* the
  // sandbox at is left alone (`assistWorker` is only set for one we deployed).
  let removedWorker: string | null = null;
  try {
    const app = await db.getSandboxApp(id);
    const settings = app?.settings ? JSON.parse(app.settings) : {};
    const worker = typeof settings.assistWorker === "string" ? settings.assistWorker : "";
    if (worker) {
      stopAgent(worker);
      deleteAgentFiles(worker);
      const agent = await db.findAgentByName(worker);
      if (agent) {
        await db.deleteAgentVersions(worker);
        await db.deleteAgent(agent.id);
      }
      removedWorker = worker;
    }
  } catch {
    // Unparseable settings or a worker already gone: deleting the sandbox is
    // still the request, and failing it would leave the row behind too.
  }

  stopSandbox(name);
  deleteSandboxDir(name);

  await db.deleteSandboxApp(id);

  return NextResponse.json({ success: true, removedWorker });
}
