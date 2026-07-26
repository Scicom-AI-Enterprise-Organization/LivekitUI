/**
 * The API reference's source of truth.
 *
 * Every route under src/app/api is listed here. When a route's wire shape
 * changes, update its entry — tests/authz.test.mjs keeps the endpoint list
 * honest about auth, but nothing enforces the samples.
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Param {
  name: string;
  in: "query" | "body" | "path";
  type: string;
  required?: boolean;
  doc: string;
}

export interface Endpoint {
  id: string;
  group: string;
  method: Method;
  path: string;
  title: string;
  description: string;
  /** Omitted means "any authenticated caller". */
  role?: "owner/admin" | "public";
  params?: Param[];
  request?: string;
  response?: string;
}

export interface Group {
  id: string;
  title: string;
  blurb: string;
}

export const GROUPS: Group[] = [
  { id: "auth", title: "Authentication", blurb: "Sign in, inspect the caller, and manage accounts. Login and setup-check are the only routes reachable without credentials." },
  { id: "tokens", title: "Access tokens", blurb: "Bearer tokens for this API. A token inherits the role of whoever created it, and revoking one takes effect on its next request." },
  { id: "agents", title: "Agents", blurb: "Deploy, monitor, and control voice agents. An agent's Python process is spawned and supervised by the dashboard." },
  { id: "keys", title: "LiveKit API keys", blurb: "Keys handed to agents and sandboxes for connecting to LiveKit. Validated by the gateway, which re-signs them with the server's real key." },
  { id: "rooms", title: "Rooms and sessions", blurb: "Live room and participant state, read straight from the LiveKit server." },
  { id: "egress", title: "Egress", blurb: "Record or restream a room. Needs the LiveKit egress service; without it these answer 503 with serviceAvailable:false." },
  { id: "ingress", title: "Ingress", blurb: "Publish an external RTMP, WHIP, or pulled stream into a room. Needs the LiveKit ingress service." },
  { id: "telephony", title: "Telephony", blurb: "SIP trunks, dispatch rules, calls, and phone numbers. Trunks and rules need the LiveKit SIP service; calls and numbers do not." },
  { id: "tools", title: "Tool library", blurb: "Reusable HTTP tools, client tools, and MCP servers that agents import from the builder's Actions tab." },
  { id: "sandboxes", title: "Sandboxes", blurb: "Frontend templates spun up per app and proxied at /sandbox/{name}." },
  { id: "config", title: "Providers and secrets", blurb: "Inference endpoints the agent builder offers, and project-wide secrets injected into agents." },
  { id: "monitoring", title: "Monitoring", blurb: "Aggregate stats, Prometheus-derived metrics, and the webhook event log." },
];

export const ENDPOINTS: Endpoint[] = [
  // ── Authentication ──
  {
    id: "login", group: "auth", method: "POST", path: "/api/auth/login", role: "public",
    title: "Sign in",
    description: "Exchanges credentials for an lk_session cookie. Scripts should use a Bearer token instead.",
    params: [
      { name: "email", in: "body", type: "string", required: true, doc: "Account email." },
      { name: "password", in: "body", type: "string", required: true, doc: "Account password." },
    ],
    request: `curl -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \\\n  -d '{"email":"you@example.com","password":"…"}' -c cookies.txt`,
    response: `{ "user": { "id": 1, "email": "you@example.com", "firstName": "Ada", "lastName": "L", "role": "owner" } }`,
  },
  {
    id: "logout", group: "auth", method: "POST", path: "/api/auth/logout",
    title: "Sign out",
    description: "Destroys the current session. A Bearer token is unaffected — revoke it instead.",
    request: `curl -X POST $BASE/api/auth/logout -b cookies.txt`,
    response: `{ "success": true }`,
  },
  {
    id: "me", group: "auth", method: "GET", path: "/api/auth/me",
    title: "Who am I",
    description: "The caller behind the current cookie or Bearer token, including their role.",
    request: `curl $BASE/api/auth/me -H "Authorization: Bearer $TOKEN"`,
    response: `{ "user": { "id": 1, "email": "you@example.com", "role": "owner" } }`,
  },
  {
    id: "setup-check", group: "auth", method: "GET", path: "/api/auth/setup-check", role: "public",
    title: "Is the instance set up",
    description: "Whether any account exists. Drives the first-run redirect to /register.",
    request: `curl $BASE/api/auth/setup-check`,
    response: `{ "hasUsers": true }`,
  },
  {
    id: "register", group: "auth", method: "POST", path: "/api/auth/register", role: "public",
    title: "Register",
    description: "Creates an account. The first account becomes the owner; later ones need an invite token.",
    params: [
      { name: "email", in: "body", type: "string", required: true, doc: "New account email." },
      { name: "password", in: "body", type: "string", required: true, doc: "At least 8 characters." },
      { name: "firstName", in: "body", type: "string", required: true, doc: "Given name." },
      { name: "lastName", in: "body", type: "string", required: true, doc: "Family name." },
      { name: "inviteToken", in: "body", type: "string", doc: "Required once an owner exists." },
    ],
    request: `curl -X POST $BASE/api/auth/register -H 'Content-Type: application/json' \\\n  -d '{"email":"a@b.c","password":"…","firstName":"Ada","lastName":"L"}'`,
  },
  {
    id: "invite", group: "auth", method: "POST", path: "/api/auth/invite", role: "owner/admin",
    title: "Invite a teammate",
    description: "Mints an invite token for an email and role.",
    params: [
      { name: "email", in: "body", type: "string", required: true, doc: "Who to invite." },
      { name: "role", in: "body", type: "string", required: true, doc: `"admin" or "member".` },
    ],
    request: `curl -X POST $BASE/api/auth/invite -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"email":"new@example.com","role":"member"}'`,
  },
  {
    id: "invite-info", group: "auth", method: "GET", path: "/api/auth/invite-info", role: "public",
    title: "Inspect an invite",
    description: "Resolves an invite token to the email and role it was issued for.",
    params: [{ name: "token", in: "query", type: "string", required: true, doc: "The invite token." }],
    request: `curl "$BASE/api/auth/invite-info?token=…"`,
  },
  {
    id: "users", group: "auth", method: "GET", path: "/api/auth/users",
    title: "List team members",
    description: "Every account with its role.",
    request: `curl $BASE/api/auth/users -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "delete-user", group: "auth", method: "DELETE", path: "/api/auth/users", role: "owner/admin",
    title: "Remove a team member",
    description: "Deletes an account. The owner cannot be removed.",
    params: [{ name: "id", in: "body", type: "number", required: true, doc: "User id." }],
    request: `curl -X DELETE $BASE/api/auth/users -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"id":4}'`,
  },
  {
    id: "password", group: "auth", method: "POST", path: "/api/auth/password",
    title: "Change password",
    description: "Requires the current password and signs out every other device.",
    params: [
      { name: "currentPassword", in: "body", type: "string", required: true, doc: "Existing password." },
      { name: "newPassword", in: "body", type: "string", required: true, doc: "At least 8 characters." },
    ],
    request: `curl -X POST $BASE/api/auth/password -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"currentPassword":"…","newPassword":"…"}'`,
  },
  {
    id: "profile", group: "auth", method: "PATCH", path: "/api/auth/profile",
    title: "Update profile",
    description: "Changes the caller's name and company.",
    request: `curl -X PATCH $BASE/api/auth/profile -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"firstName":"Ada","lastName":"L","company":"Acme"}'`,
  },

  // ── Access tokens ──
  {
    id: "list-tokens", group: "tokens", method: "GET", path: "/api/access-tokens",
    title: "List access tokens",
    description: "Owners and admins see every token; members see their own. The token value is never returned.",
    request: `curl $BASE/api/access-tokens -H "Authorization: Bearer $TOKEN"`,
    response: `{ "tokens": [ { "id": 3, "name": "ci-bot", "prefix": "lkui_AbCdEf",\n    "owner": "you@example.com", "createdAt": "2026-07-25T12:00:00Z",\n    "lastUsedAt": "2026-07-25T12:31:04Z", "revokedAt": null } ] }`,
  },
  {
    id: "create-token", group: "tokens", method: "POST", path: "/api/access-tokens",
    title: "Create an access token",
    description: "Returns the token once. Only a SHA-256 hash is stored, so it cannot be recovered later.",
    params: [{ name: "name", in: "body", type: "string", required: true, doc: "A label, e.g. ci-bot." }],
    request: `curl -X POST $BASE/api/access-tokens -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"name":"ci-bot"}'`,
    response: `{ "id": 4, "name": "ci-bot", "prefix": "lkui_AbCdEf",\n  "token": "lkui_AbCdEf…", "createdAt": "2026-07-25T12:40:00Z" }`,
  },
  {
    id: "revoke-token", group: "tokens", method: "DELETE", path: "/api/access-tokens/{id}",
    title: "Revoke an access token",
    description: "Takes effect on the token's next request — tokens are looked up per call with no cache.",
    params: [{ name: "id", in: "path", type: "number", required: true, doc: "Token id." }],
    request: `curl -X DELETE $BASE/api/access-tokens/4 -H "Authorization: Bearer $TOKEN"`,
    response: `{ "success": true, "revoked": true }`,
  },

  // ── Agents ──
  {
    id: "list-agents", group: "agents", method: "GET", path: "/api/agents",
    title: "List agents",
    description: "Agents from the database merged with live LiveKit state. A nameless auto-dispatch is a dispatch, not a worker, so it is not listed here.",
    params: [{ name: "hours", in: "query", type: "number", doc: "History window for the chart. Default 24." }],
    request: `curl "$BASE/api/agents?hours=24" -H "Authorization: Bearer $TOKEN"`,
    response: `{ "agents": [ { "agentName": "Avery-m973", "status": "connected", "running": true,\n      "concurrentSessions": 1, "rooms": ["room-1"], "pid": 74930, "region": "local" } ],\n  "sessions": [ … ], "stats": { "totalAgents": 1, "totalSessions": 1 }, "history": [ … ] }`,
  },
  {
    id: "create-agent", group: "agents", method: "POST", path: "/api/agents", role: "owner/admin",
    title: "Create or update an agent",
    description: "Upserts by name. Writes the generated Python but does not start it — deploy does that.",
    params: [
      { name: "name", in: "body", type: "string", required: true, doc: "Agent name, unique." },
      { name: "config", in: "body", type: "object", required: true, doc: "Builder config: instructions, models, voice." },
      { name: "status", in: "body", type: "string", doc: `"draft" or "deployed".` },
    ],
    request: `curl -X POST $BASE/api/agents -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"support-bot","config":{"instructions":"Be brief."},"status":"draft"}'`,
  },
  {
    id: "delete-agent", group: "agents", method: "DELETE", path: "/api/agents", role: "owner/admin",
    title: "Delete an agent",
    description: "Stops the process and removes its files, versions, and secrets.",
    params: [{ name: "name", in: "body", type: "string", required: true, doc: "Agent name." }],
    request: `curl -X DELETE $BASE/api/agents -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"name":"support-bot"}'`,
  },
  {
    id: "agent-by-name", group: "agents", method: "GET", path: "/api/agents/by-name",
    title: "Get one agent",
    description: "The stored config for a single agent. 404 when it doesn't exist.",
    params: [{ name: "name", in: "query", type: "string", required: true, doc: "Agent name." }],
    request: `curl "$BASE/api/agents/by-name?name=support-bot" -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "rename-agent", group: "agents", method: "POST", path: "/api/agents/rename", role: "owner/admin",
    title: "Rename an agent",
    description: "Moves the agent's directory and updates its dispatch name.",
    params: [
      { name: "oldName", in: "body", type: "string", required: true, doc: "Current name." },
      { name: "newName", in: "body", type: "string", required: true, doc: "New name." },
    ],
    request: `curl -X POST $BASE/api/agents/rename -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"oldName":"a","newName":"b"}'`,
  },
  {
    id: "deploy-agent", group: "agents", method: "POST", path: "/api/agents/{name}/deploy", role: "owner/admin",
    title: "Deploy an agent",
    description: "Writes .env.local from project and per-agent secrets, then starts the Python worker.",
    params: [{ name: "name", in: "path", type: "string", required: true, doc: "Agent name." }],
    request: `curl -X POST $BASE/api/agents/support-bot/deploy -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "stop-agent", group: "agents", method: "POST", path: "/api/agents/{name}/stop", role: "owner/admin",
    title: "Stop an agent",
    description: "Terminates the worker process. The config and files stay.",
    request: `curl -X POST $BASE/api/agents/support-bot/stop -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "restart-agent", group: "agents", method: "POST", path: "/api/agents/{name}/restart", role: "owner/admin",
    title: "Restart an agent",
    description: "Stop then deploy, picking up changed secrets and provider settings.",
    request: `curl -X POST $BASE/api/agents/support-bot/restart -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "agent-logs", group: "agents", method: "GET", path: "/api/agents/{name}/logs",
    title: "Agent logs",
    description: "Tail of the worker's stdout and stderr. Reads only the last window of the file rather than loading all of it, and never opens on a half-written line. Poll it for a live tail.",
    params: [
      { name: "tail", in: "query", type: "string", doc: '"10kb" (default), "50kb", "100kb", or "all".' },
    ],
    request: `curl "$BASE/api/agents/support-bot/logs?tail=50kb" -H "Authorization: Bearer $TOKEN"`,
    response: `{ "logs": "…", "running": true, "tail": "50kb",\n  "size": 180471, "truncated": true }`,
  },
  {
    id: "agent-metrics", group: "agents", method: "GET", path: "/api/agents/{name}/metrics",
    title: "Agent metrics",
    description: "Current session count and process state for one agent.",
    request: `curl "$BASE/api/agents/support-bot/metrics" -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "agent-history", group: "agents", method: "GET", path: "/api/agents/{name}/history",
    title: "Agent history",
    description: "Per-agent session snapshots for the chart.",
    params: [{ name: "hours", in: "query", type: "number", doc: "Window. Default 24." }],
    request: `curl "$BASE/api/agents/support-bot/history?hours=168" -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "agent-versions", group: "agents", method: "GET", path: "/api/agents/{name}/versions",
    title: "Agent deploy history",
    description: "Who deployed each version, and when.",
    request: `curl "$BASE/api/agents/support-bot/versions" -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "agent-secrets", group: "agents", method: "GET", path: "/api/agents/{name}/secrets", role: "owner/admin",
    title: "Per-agent secrets",
    description: "Secrets scoped to one agent. These override project secrets of the same name. POST upserts, DELETE removes by key.",
    request: `curl "$BASE/api/agents/support-bot/secrets" -H "Authorization: Bearer $TOKEN"`,
  },

  // ── LiveKit API keys ──
  {
    id: "list-keys", group: "keys", method: "GET", path: "/api/api-keys",
    title: "List LiveKit keys",
    description: "Issued keys plus the server's own pair from .env. Issued secrets are never returned; the server secret is owner/admin only.",
    request: `curl $BASE/api/api-keys -H "Authorization: Bearer $TOKEN"`,
    response: `{ "wsUrl": "ws://localhost:7880", "apiKey": "devkey",\n  "gatewayUrl": "ws://localhost:7885", "gatewayConfigured": true,\n  "keys": [ { "id": 3, "description": "voice-agent-prod", "apiKey": "APIbA1MRc4oXUEp",\n      "owner": "you@example.com", "revokedAt": null } ] }`,
  },
  {
    id: "create-key", group: "keys", method: "POST", path: "/api/api-keys", role: "owner/admin",
    title: "Generate a LiveKit key",
    description: "Returns the secret once. Hand it out with the gateway URL — the LiveKit server itself does not know this key.",
    params: [{ name: "description", in: "body", type: "string", required: true, doc: "What the key is for." }],
    request: `curl -X POST $BASE/api/api-keys -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"description":"voice-agent-prod"}'`,
    response: `{ "id": 5, "apiKey": "APIbA1MRc4oXUEp", "apiSecret": "CpHzxrzt…",\n  "wsUrl": "ws://localhost:7885", "gatewayConfigured": true }`,
  },
  {
    id: "revoke-key", group: "keys", method: "DELETE", path: "/api/api-keys/{id}", role: "owner/admin",
    title: "Revoke a LiveKit key",
    description: "Effective on the key's next connection, with no LiveKit restart. Pass ?hard=1 to delete the row outright.",
    params: [
      { name: "id", in: "path", type: "number", required: true, doc: "Key id." },
      { name: "hard", in: "query", type: "1", doc: "Delete instead of marking revoked." },
    ],
    request: `curl -X DELETE $BASE/api/api-keys/5 -H "Authorization: Bearer $TOKEN"`,
    response: `{ "success": true, "revoked": true }`,
  },
  {
    id: "livekit-token", group: "keys", method: "POST", path: "/api/livekit/token",
    title: "Mint a room token",
    description: "Issues a participant JWT for the agent preview and spawns a preview worker.",
    request: `curl -X POST $BASE/api/livekit/token -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"agentName":"support-bot"}'`,
  },

  // ── Rooms ──
  {
    id: "list-rooms", group: "rooms", method: "GET", path: "/api/rooms",
    title: "List rooms",
    description: "Active rooms from the LiveKit server, with participant counts.",
    request: `curl $BASE/api/rooms -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "room-participants", group: "rooms", method: "GET", path: "/api/rooms/{name}/participants",
    title: "List participants",
    description: "Participants in one room, including agent and SIP participants.",
    params: [{ name: "name", in: "path", type: "string", required: true, doc: "Room name." }],
    request: `curl "$BASE/api/rooms/my-room/participants" -H "Authorization: Bearer $TOKEN"`,
  },

  // ── Egress ──
  {
    id: "list-egresses", group: "egress", method: "GET", path: "/api/egresses",
    title: "List egresses",
    description: "Recording and streaming jobs, newest first. 503 with serviceAvailable:false when the egress service is not connected.",
    params: [
      { name: "room", in: "query", type: "string", doc: "Only this room's egresses." },
      { name: "active", in: "query", type: "1", doc: "Only jobs still running." },
    ],
    request: `curl "$BASE/api/egresses?active=1" -H "Authorization: Bearer $TOKEN"`,
    response: `{ "egresses": [ { "egressId": "EG_x", "roomName": "my-room", "status": "active",\n      "type": "roomComposite", "startedAt": "2026-07-25T12:00:00Z", "durationSeconds": 42,\n      "destinations": [ { "kind": "file", "location": "/out/rec.mp4", "size": 10485760 } ] } ],\n  "total": 1 }`,
  },
  {
    id: "start-egress", group: "egress", method: "POST", path: "/api/egresses", role: "owner/admin",
    title: "Start a room composite egress",
    description: "Records a room to a file, or restreams it over RTMP.",
    params: [
      { name: "room", in: "body", type: "string", required: true, doc: "Room to capture." },
      { name: "type", in: "body", type: "string", required: true, doc: `"file" or "stream".` },
      { name: "filepath", in: "body", type: "string", doc: "Required for type=file." },
      { name: "url", in: "body", type: "string", doc: "RTMP(S) target, required for type=stream." },
      { name: "layout", in: "body", type: "string", doc: `Composite layout. Default "grid".` },
      { name: "audioOnly", in: "body", type: "boolean", doc: "Skip video." },
    ],
    request: `curl -X POST $BASE/api/egresses -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"room":"my-room","type":"file","filepath":"/out/rec.mp4"}'`,
  },
  {
    id: "stop-egress", group: "egress", method: "POST", path: "/api/egresses/{id}/stop", role: "owner/admin",
    title: "Stop an egress",
    description: "Ends a running job and finalises its output.",
    params: [{ name: "id", in: "path", type: "string", required: true, doc: "Egress id." }],
    request: `curl -X POST $BASE/api/egresses/EG_x/stop -H "Authorization: Bearer $TOKEN"`,
  },

  // ── Ingress ──
  {
    id: "list-ingresses", group: "ingress", method: "GET", path: "/api/ingresses",
    title: "List ingresses",
    description: "Configured ingresses and their publishing state. 503 with serviceAvailable:false when the ingress service is not connected.",
    params: [{ name: "room", in: "query", type: "string", doc: "Only this room's ingresses." }],
    request: `curl $BASE/api/ingresses -H "Authorization: Bearer $TOKEN"`,
    response: `{ "ingresses": [ { "ingressId": "IN_x", "name": "studio-feed", "inputType": 0,\n      "roomName": "my-room", "streamKey": "…", "url": "rtmp://…", "status": "publishing" } ],\n  "total": 1 }`,
  },
  {
    id: "create-ingress", group: "ingress", method: "POST", path: "/api/ingresses", role: "owner/admin",
    title: "Create an ingress",
    description: "RTMP and WHIP return a streamKey to push to; url pulls the stream you name.",
    params: [
      { name: "name", in: "body", type: "string", required: true, doc: "Ingress name." },
      { name: "room", in: "body", type: "string", required: true, doc: "Room to publish into." },
      { name: "inputType", in: "body", type: "string", doc: `"rtmp" (default), "whip", or "url".` },
      { name: "url", in: "body", type: "string", doc: "Required for inputType=url." },
      { name: "participantIdentity", in: "body", type: "string", doc: "Defaults to ingress-{name}." },
      { name: "reusable", in: "body", type: "boolean", doc: "Allow repeated sessions." },
    ],
    request: `curl -X POST $BASE/api/ingresses -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"studio-feed","room":"my-room","inputType":"rtmp"}'`,
  },
  {
    id: "delete-ingress", group: "ingress", method: "DELETE", path: "/api/ingresses/{id}", role: "owner/admin",
    title: "Delete an ingress",
    description: "Removes the ingress and stops any active session.",
    request: `curl -X DELETE $BASE/api/ingresses/IN_x -H "Authorization: Bearer $TOKEN"`,
  },

  // ── Telephony ──
  {
    id: "list-calls", group: "telephony", method: "GET", path: "/api/calls",
    title: "List active calls",
    description: "Derived from SIP participants in rooms — LiveKit has no call list of its own. Works without the SIP service.",
    params: [{ name: "room", in: "query", type: "string", doc: "Only this room's calls." }],
    request: `curl $BASE/api/calls -H "Authorization: Bearer $TOKEN"`,
    response: `{ "calls": [ { "callId": "SCL_x", "roomName": "call-123", "from": "+15551234567",\n      "to": "+15557654321", "status": "active", "durationSeconds": 87 } ], "total": 1 }`,
  },
  {
    id: "list-trunks", group: "telephony", method: "GET", path: "/api/sip-trunks",
    title: "List SIP trunks",
    description: "Inbound and outbound trunks in one list, each tagged with its direction.",
    params: [{ name: "direction", in: "query", type: "string", doc: `"inbound" or "outbound".` }],
    request: `curl $BASE/api/sip-trunks -H "Authorization: Bearer $TOKEN"`,
    response: `{ "trunks": [ { "trunkId": "ST_x", "direction": "inbound", "name": "main",\n      "numbers": ["+15551234567"], "allowedAddresses": [] } ], "total": 1 }`,
  },
  {
    id: "create-trunk", group: "telephony", method: "POST", path: "/api/sip-trunks", role: "owner/admin",
    title: "Create a SIP trunk",
    description: "Inbound accepts calls to your numbers; outbound places them through a provider address.",
    params: [
      { name: "direction", in: "body", type: "string", required: true, doc: `"inbound" or "outbound".` },
      { name: "name", in: "body", type: "string", required: true, doc: "Trunk name." },
      { name: "numbers", in: "body", type: "string[]", required: true, doc: "Numbers this trunk handles." },
      { name: "address", in: "body", type: "string", doc: "Provider host, required for outbound." },
      { name: "transport", in: "body", type: "string", doc: `"auto" (default), "udp", "tcp", "tls".` },
      { name: "authUsername", in: "body", type: "string", doc: "SIP auth user." },
      { name: "authPassword", in: "body", type: "string", doc: "SIP auth password." },
    ],
    request: `curl -X POST $BASE/api/sip-trunks -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"direction":"inbound","name":"main","numbers":["+15551234567"]}'`,
  },
  {
    id: "delete-trunk", group: "telephony", method: "DELETE", path: "/api/sip-trunks/{id}", role: "owner/admin",
    title: "Delete a SIP trunk",
    description: "Works for inbound and outbound trunks alike.",
    request: `curl -X DELETE $BASE/api/sip-trunks/ST_x -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "list-rules", group: "telephony", method: "GET", path: "/api/dispatch-rules",
    title: "List dispatch rules",
    description: "How inbound SIP calls are routed into rooms.",
    request: `curl $BASE/api/dispatch-rules -H "Authorization: Bearer $TOKEN"`,
    response: `{ "rules": [ { "ruleId": "SDR_x", "name": "support", "type": "dispatchRuleIndividual",\n      "roomPrefix": "call-", "trunkIds": ["ST_x"] } ], "total": 1 }`,
  },
  {
    id: "create-rule", group: "telephony", method: "POST", path: "/api/dispatch-rules", role: "owner/admin",
    title: "Create a dispatch rule",
    description: `"direct" puts every caller in one room; "individual" makes a room per caller from a prefix. Scope a rule with trunkIds.`,
    params: [
      { name: "type", in: "body", type: "string", required: true, doc: `"direct" or "individual".` },
      { name: "roomName", in: "body", type: "string", doc: "Required for type=direct." },
      { name: "roomPrefix", in: "body", type: "string", doc: "Required for type=individual." },
      { name: "trunkIds", in: "body", type: "string[]", doc: "Limit to these trunks." },
      { name: "pin", in: "body", type: "string", doc: "Require a DTMF pin." },
      { name: "hidePhoneNumber", in: "body", type: "boolean", doc: "Omit the caller's number." },
    ],
    request: `curl -X POST $BASE/api/dispatch-rules -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"type":"individual","roomPrefix":"call-","name":"support"}'`,
  },
  {
    id: "delete-rule", group: "telephony", method: "DELETE", path: "/api/dispatch-rules/{id}", role: "owner/admin",
    title: "Delete a dispatch rule",
    description: "Removes the rule; existing calls are unaffected.",
    request: `curl -X DELETE $BASE/api/dispatch-rules/SDR_x -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "list-numbers", group: "telephony", method: "GET", path: "/api/phone-numbers",
    title: "List phone numbers",
    description: "Numbers added by hand or imported from a provider.",
    request: `curl $BASE/api/phone-numbers -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "add-number", group: "telephony", method: "POST", path: "/api/phone-numbers", role: "owner/admin",
    title: "Add a phone number",
    description: "Records a number manually — no provider credentials needed.",
    params: [
      { name: "number", in: "body", type: "string", required: true, doc: "E.164 number." },
      { name: "label", in: "body", type: "string", doc: "Display label." },
    ],
    request: `curl -X POST $BASE/api/phone-numbers -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"number":"+15551234567","label":"Support"}'`,
  },
  {
    id: "delete-number", group: "telephony", method: "DELETE", path: "/api/phone-numbers", role: "owner/admin",
    title: "Delete a phone number",
    description: "Removes a stored number.",
    params: [{ name: "id", in: "body", type: "number", required: true, doc: "Number id." }],
    request: `curl -X DELETE $BASE/api/phone-numbers -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"id":2}'`,
  },
  {
    id: "number-providers", group: "telephony", method: "GET", path: "/api/phone-numbers/providers",
    title: "Configured number providers",
    description: "Which of Twilio, Vonage, and Telnyx have credentials in .env.",
    request: `curl $BASE/api/phone-numbers/providers -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "import-numbers", group: "telephony", method: "POST", path: "/api/phone-numbers/import", role: "owner/admin",
    title: "Import numbers from a provider",
    description: "Pulls the number inventory from Twilio, Vonage, or Telnyx.",
    params: [{ name: "provider", in: "body", type: "string", required: true, doc: `"twilio", "vonage", or "telnyx".` }],
    request: `curl -X POST $BASE/api/phone-numbers/import -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"provider":"twilio"}'`,
  },

  // ── Tool library ──
  {
    id: "list-tools", group: "tools", method: "GET", path: "/api/tools",
    title: "List library tools",
    description: "Every reusable tool definition. Agents hold their own copy, so this is the source they were imported from, not a live link.",
    params: [{ name: "kind", in: "query", type: "string", doc: `"http", "client", or "mcp".` }],
    request: `curl "$BASE/api/tools?kind=http" -H "Authorization: Bearer $TOKEN"`,
    response: `{ "tools": [ { "id": 1, "kind": "http", "name": "get_weather",\n      "description": "Look up the weather for a city",\n      "config": { "method": "GET", "url": "https://api.example.com/weather",\n        "params": [ { "name": "city", "type": "string", "required": true } ] } } ],\n  "total": 1 }`,
  },
  {
    id: "save-tool", group: "tools", method: "POST", path: "/api/tools", role: "owner/admin",
    title: "Create or update a library tool",
    description: "Upserts on (kind, name). The name becomes a function name for the model, so it must be a valid identifier. Editing here does not change agents that already imported it.",
    params: [
      { name: "kind", in: "body", type: "string", required: true, doc: `"http", "client", or "mcp".` },
      { name: "name", in: "body", type: "string", required: true, doc: "Identifier — letters, digits, underscore, hyphen." },
      { name: "description", in: "body", type: "string", doc: "When the model should use it." },
      { name: "config", in: "body", type: "object", required: true, doc: "The tool body: url and method for http, params for http/client, url and headers for mcp." },
    ],
    request: `curl -X POST $BASE/api/tools -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"kind":"http","name":"get_weather","config":{"method":"GET","url":"https://api.example.com/weather","params":[],"headers":[]}}'`,
  },
  {
    id: "openapi-import", group: "tools", method: "POST", path: "/api/tools/openapi", role: "owner/admin",
    title: "Read an OpenAPI spec",
    description: "Converts an OpenAPI 3.x or Swagger 2.0 document (JSON or YAML) into HTTP tool definitions. Nothing is saved — POST the ones you want to /api/tools. Fetching happens server-side, so specs on hosts without CORS headers work.",
    params: [
      { name: "url", in: "body", type: "string", doc: "Spec URL to fetch. Either this or spec." },
      { name: "spec", in: "body", type: "string", doc: "The document itself, as JSON or YAML text." },
    ],
    request: `curl -X POST $BASE/api/tools/openapi -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"url":"https://petstore3.swagger.io/api/v3/openapi.json"}'`,
    response: `{ "title": "Swagger Petstore", "version": "1.0.0",\n  "baseUrl": "https://petstore3.swagger.io/api/v3",\n  "tools": [ { "name": "get_pet_by_id", "method": "GET",\n      "url": "https://petstore3.swagger.io/api/v3/pet/{petId}",\n      "params": [ { "name": "petId", "type": "integer", "required": true } ],\n      "headers": [] } ],\n  "skipped": [ { "operation": "GET /pet/findByTags", "reason": "deprecated" } ] }`,
  },
  {
    id: "delete-tool", group: "tools", method: "DELETE", path: "/api/tools/{id}", role: "owner/admin",
    title: "Delete a library tool",
    description: "Removes the entry. Agents that imported it keep their copy and are unaffected.",
    params: [{ name: "id", in: "path", type: "number", required: true, doc: "Tool id." }],
    request: `curl -X DELETE $BASE/api/tools/1 -H "Authorization: Bearer $TOKEN"`,
    response: `{ "success": true, "deleted": true }`,
  },

  // ── Sandboxes ──
  {
    id: "list-sandboxes", group: "sandboxes", method: "GET", path: "/api/sandbox-apps",
    title: "List sandbox apps",
    description: "Sandboxes with their template, port, and status.",
    request: `curl $BASE/api/sandbox-apps -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "create-sandbox", group: "sandboxes", method: "POST", path: "/api/sandbox-apps", role: "owner/admin",
    title: "Create a sandbox",
    description: "Provisions from a template and starts its dev server on a free port.",
    params: [
      { name: "name", in: "body", type: "string", required: true, doc: "Sandbox name, used in the proxy path." },
      { name: "template", in: "body", type: "string", required: true, doc: "Template directory under example/." },
      { name: "agentName", in: "body", type: "string", doc: "Agent to dispatch. Empty means auto-dispatch." },
    ],
    request: `curl -X POST $BASE/api/sandbox-apps -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"test","template":"agent-starter-react"}'`,
  },
  {
    id: "delete-sandbox", group: "sandboxes", method: "DELETE", path: "/api/sandbox-apps", role: "owner/admin",
    title: "Delete a sandbox",
    description: "Stops the dev server and removes the sandbox directory.",
    params: [{ name: "id", in: "body", type: "number", required: true, doc: "Sandbox id." }],
    request: `curl -X DELETE $BASE/api/sandbox-apps -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"id":3}'`,
  },
  {
    id: "get-sandbox", group: "sandboxes", method: "GET", path: "/api/sandbox-apps/{id}",
    title: "Get a sandbox",
    description: "One sandbox and its settings. PATCH the same path to change them.",
    request: `curl $BASE/api/sandbox-apps/3 -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "restart-sandbox", group: "sandboxes", method: "POST", path: "/api/sandbox-apps/restart", role: "owner/admin",
    title: "Restart a sandbox",
    description: "Re-provisions, clears the build cache, and restarts on the same port.",
    params: [
      { name: "id", in: "body", type: "number", required: true, doc: "Sandbox id." },
      { name: "name", in: "body", type: "string", required: true, doc: "Sandbox name." },
    ],
    request: `curl -X POST $BASE/api/sandbox-apps/restart -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"id":3,"name":"test"}'`,
  },
  {
    id: "sandbox-logs", group: "sandboxes", method: "GET", path: "/api/sandbox-apps/logs",
    title: "Sandbox logs",
    description: "Dev-server output for one sandbox.",
    params: [{ name: "name", in: "query", type: "string", required: true, doc: "Sandbox name." }],
    request: `curl "$BASE/api/sandbox-apps/logs?name=test" -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "resolve-sandbox", group: "sandboxes", method: "GET", path: "/api/sandbox-apps/resolve", role: "public",
    title: "Resolve a sandbox port",
    description: "Internal: the proxy calls this on every /sandbox/{name} request, before any session exists.",
    params: [{ name: "name", in: "query", type: "string", required: true, doc: "Sandbox name." }],
    request: `curl "$BASE/api/sandbox-apps/resolve?name=test"`,
    response: `{ "port": 3100 }`,
  },
  {
    id: "sandbox-config", group: "sandboxes", method: "GET", path: "/api/sandbox-config",
    title: "Sandbox proxy base",
    description: "The base URL sandboxes are served under.",
    request: `curl $BASE/api/sandbox-config -H "Authorization: Bearer $TOKEN"`,
  },

  // ── Providers and secrets ──
  {
    id: "list-providers", group: "config", method: "GET", path: "/api/providers",
    title: "List providers",
    description: "Every inference endpoint and the models it offers the agent builder.",
    request: `curl $BASE/api/providers -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "save-provider", group: "config", method: "POST", path: "/api/providers", role: "owner/admin",
    title: "Create or update a provider",
    description: "Upserts by slug. A connection test must pass before a provider can be saved from the UI.",
    params: [
      { name: "slug", in: "body", type: "string", required: true, doc: "Short id used in model refs." },
      { name: "name", in: "body", type: "string", required: true, doc: "Display name." },
      { name: "plugin", in: "body", type: "string", required: true, doc: "LiveKit plugin, e.g. openai." },
      { name: "baseUrl", in: "body", type: "string", doc: "OpenAI-compatible endpoint. Empty uses the plugin default." },
      { name: "apiKeySecret", in: "body", type: "string", doc: "Name of a secret holding the key." },
      { name: "models", in: "body", type: "object[]", doc: "Models with their kind: llm, stt, tts, realtime." },
    ],
    request: `curl -X POST $BASE/api/providers -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"slug":"vllm","name":"vLLM","plugin":"openai","baseUrl":"http://localhost:8000/v1","models":[]}'`,
  },
  {
    id: "delete-provider", group: "config", method: "DELETE", path: "/api/providers", role: "owner/admin",
    title: "Delete a provider",
    description: "Removes a provider, built-in ones included.",
    params: [{ name: "slug", in: "body", type: "string", required: true, doc: "Provider slug." }],
    request: `curl -X DELETE $BASE/api/providers -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"slug":"vllm"}'`,
  },
  {
    id: "test-provider", group: "config", method: "POST", path: "/api/providers/test", role: "owner/admin",
    title: "Test a provider connection",
    description: "One read-only listing request against the endpoint. Returns the models it reports.",
    request: `curl -X POST $BASE/api/providers/test -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"plugin":"openai","baseUrl":"http://localhost:8000/v1"}'`,
  },
  {
    id: "list-secrets", group: "config", method: "GET", path: "/api/secrets",
    title: "List secrets",
    description: "Project-wide secrets. Values are masked unless the caller is an owner or admin.",
    request: `curl $BASE/api/secrets -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "save-secret", group: "config", method: "POST", path: "/api/secrets", role: "owner/admin",
    title: "Create or update a secret",
    description: "Upserts by name. The name is used verbatim as the env var in every deployed agent.",
    params: [
      { name: "name", in: "body", type: "string", required: true, doc: "A valid env var name." },
      { name: "value", in: "body", type: "string", required: true, doc: "Secret value." },
      { name: "description", in: "body", type: "string", doc: "What it is for." },
    ],
    request: `curl -X POST $BASE/api/secrets -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"OPENAI_API_KEY","value":"sk-…"}'`,
  },
  {
    id: "delete-secret", group: "config", method: "DELETE", path: "/api/secrets", role: "owner/admin",
    title: "Delete a secret",
    description: "Removes a secret. Deployed agents keep it until they restart.",
    params: [{ name: "name", in: "body", type: "string", required: true, doc: "Secret name." }],
    request: `curl -X DELETE $BASE/api/secrets -H "Authorization: Bearer $TOKEN" \\\n  -H 'Content-Type: application/json' -d '{"name":"OPENAI_API_KEY"}'`,
  },

  // ── Monitoring ──
  {
    id: "overview", group: "monitoring", method: "GET", path: "/api/overview",
    title: "Overview stats",
    description: "Connection counts, participant minutes, and room sessions for the dashboard home.",
    request: `curl $BASE/api/overview -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "metrics", group: "monitoring", method: "GET", path: "/api/metrics",
    title: "Server metrics",
    description: "Bandwidth and connection numbers scraped from the LiveKit server's Prometheus endpoint.",
    request: `curl $BASE/api/metrics -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "webhook-events", group: "monitoring", method: "GET", path: "/api/webhooks",
    title: "Webhook event log",
    description: "Recent LiveKit events with their full payloads. DELETE the same path to clear the log.",
    params: [{ name: "limit", in: "query", type: "number", doc: "How many events. Default 100." }],
    request: `curl "$BASE/api/webhooks?limit=50" -H "Authorization: Bearer $TOKEN"`,
  },
  {
    id: "webhook-receiver", group: "monitoring", method: "POST", path: "/api/webhooks/livekit", role: "public",
    title: "Webhook receiver",
    description: "Where the LiveKit server posts events. Point livekit.yaml's webhook.urls here; it is not for your own calls.",
    request: `# in livekit.yaml\nwebhook:\n  urls: [http://localhost:3010/api/webhooks/livekit]\n  api_key: devkey`,
  },
];
