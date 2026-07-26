# src/app/(dashboard) — dashboard pages

`layout.tsx` is the auth guard: it calls `getSession()` and redirects to `/login` when invalid. This is deliberate — middleware only checks that the `lk_session` cookie *exists*, so a stale cookie would otherwise render a dashboard where every fetch 401s (empty tables, missing owner-only buttons, no error). Because the layout reads cookies, all these routes are server-rendered on demand (`ƒ`), not statically prerendered.

Pages themselves are `"use client"` and fetch from `/api/*`. None touch the database directly.

## Building a page

- `TopBar` for the header: `title`, `breadcrumb`, `actions`.
- `useApiList` (`src/hooks/use-api-list.ts`) for list pages — it returns `{items, loading, error, notice, reload}` and turns a 503 `serviceAvailable: false` body into `notice`, which you render with `ServiceNotice` from `components/livekit/list-state.tsx`. That is how "SIP isn't deployed" reads as an explanation rather than a failure.
- `DataTable` / `StatCard` for tabular and summary blocks.
- Success and failure are **toasts** (`sonner`), never a modal. Modals are for input and destructive confirmation only.
- Never leave a button without a handler. A dead `<Button>Create</Button>` looks identical to a working one and has cost real debugging time here.

## Deriving state from the URL

Prefer the URL over duplicated `useState`:

- `/settings/providers?provider=new|<slug>` — which dialog is open. The dialog is keyed on the param so it mounts fresh and seeds its own state from props; no effects needed.
- `/agents/builder?agent=<name>&setting=<tab>` — which agent and tab.
- `/agents/[id]/console?talk=browser|sip&tab=<dock tab>` — how you reach the agent, and which dock tab is open.
- `/agents/tools?kind=<http|client|mcp>&tool=new|<name>` — which tool form is open; `?import=openapi` opens the OpenAPI importer.

Reading `useSearchParams()` in a client page requires a `<Suspense>` boundary around the content component, or the build fails.

## Page-specific notes

- **agents/builder** — one large file: form tabs, the Python code generator (`generateAgentCode`), the live preview and the code view. Model dropdowns come from `/api/providers`; nothing is hardcoded. Saving is **explicit** — Save or Deploy, never on a timer, because the builder edits live agents; `unsaved` tracks real user edits (not a config diff, which loading and the model-value migration would both trip) and drives the indicator plus a `beforeunload` guard. The preview dispatches the deployed agent, so it reflects the last deploy rather than unsaved edits.
- **agents/[id]/console** — the live session view: stage, rail, and a resizable dock of tabs. The page owns the session state (events, metrics, transcript, recordings) and the one audio handle the panels share; the panels themselves live in `components/livekit/console/` and are documented there. Two things to know before adding a dock tab: the dock gives `Events` and `Metrics` `overflow-hidden` because those panels manage their own panes (a pinned transport and timeline over a scrolling body), and everything else gets the dock's own scrollbar. `?talk=browser|sip` picks how you reach the agent, `?tab=` opens a dock tab. `/sessions/history/[id]` mirrors this layout with saved data and no room, so a change to one usually belongs in both.
- **agents/tools** — the reusable tool library. Agents import a *copy*, so editing an entry here never changes an agent that already uses it.
- **telephony/*** — SIP trunks, dispatch rules and calls need the SIP service (Redis + `livekit-sip`). A dispatch rule must carry an `agentName` or the caller lands in an empty room. Phone numbers is a local registry and needs none of it.
- **sandboxes** — one component serves both `/sandboxes` and `/sandboxes/[name]`; the name comes from `useParams()`, because a Next page component may not take props. A sandbox with no `agentDispatch` setting requests auto-dispatch, which builder-generated agents never match.
- **settings/providers, settings/secrets** — providers own the agent builder's model lists; a provider's API key is the *name* of a secret, and secrets are injected into every deployed agent's `.env.local`.
