# agent-assist-react

The front end for a call between two **humans** with an AI listening in: a
support agent and a customer, one shared link, live transcription of both sides,
and coaching notes only the agent sees.

Pair it with `example/agent-assist-python`, which is the worker that does the
transcribing and the coaching. Without a worker dispatched into the room the two
people can still talk; nothing gets transcribed.

## The flow

1. Both people open the **same** link — different window, tab or machine.
2. Each gives a name and takes a seat: **Support agent** or **Customer**. A seat
   already occupied is shown as taken and cannot be picked twice; two customers
   would give the worker one voice talking to itself.
3. Whoever arrives first waits in a lobby. The call goes live when the other seat
   fills.
4. Both see the whole conversation — spoken lines as they are transcribed, typed
   lines immediately. Only the support agent sees the coaching notes.

One room per sandbox (`assist-<SANDBOX_NAME>`), which is what makes a single link
enough. Add `?room=<slug>` to run several calls side by side.

## How roles reach the worker

`app/api/connection-details/route.ts` stamps them into the token:

```
assistRole = agent | customer
assistName = "Aina"
```

They arrive as participant attributes, so they survive a reconnect and every
client can see them. The token also carries `roomConfig.agents = [AGENT_NAME]`,
which is what dispatches the worker — dispatch is applied at room creation, so
putting it on both tokens is safe.

## Topics it listens on

| Topic | Rendered as |
|---|---|
| `assist.transcript` | the transcript panels; a partial is revised in place by `id` |
| `assist.suggestion` | the coaching panel — `thinking`, then token deltas, then the final text |

## Running it by hand

```bash
npm install
cp .env.example .env.local     # fill in keys and AGENT_NAME
npm run dev
```

Nothing browser-facing reads `NEXT_PUBLIC_*`: `next build` inlines those, which
would freeze the LiveKit URL at build time and break the second deployment of the
same image. `app/page.tsx` is a server component that reads the environment and
passes it down as props instead.
