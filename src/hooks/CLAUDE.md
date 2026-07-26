# src/hooks

## use-api-list.ts

The standard fetch-a-list hook for dashboard pages:

```ts
const { items, loading, error, notice, reload } = useApiList<Trunk>("/api/sip-trunks", "trunks");
```

The second argument is the response key (`{ trunks: [...] }`). It separates two failure modes on purpose:

- `error` — a genuine failure, render with `ListError`.
- `notice` — a 503 carrying `serviceAvailable: false`, i.e. the LiveKit side-service isn't deployed. Render with `ServiceNotice` and hide the empty table; it is an explanation, not an error.

Keep state updates inside `.then()` callbacks. `eslint`'s `react-hooks/set-state-in-effect` is an error in this project and fires on functions that set state synchronously when called from an effect body.

## use-theme-mode.ts

Resolves the active theme (light/dark, including `system`) for components that need to branch on it in JS rather than CSS. Prefer Tailwind's `dark:` variants and the semantic tokens where possible.
