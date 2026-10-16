# Team Agent Platform

Private multi-tenant agent workspace for business brokerage / M&A teams.

## Docs

| Doc | Purpose |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Stack, runtime split, auth, schedules |
| [`docs/provider-capabilities.md`](docs/provider-capabilities.md) | Capability matrix (MOCK vs live) |
| [`docs/implementation-status.md`](docs/implementation-status.md) | Phase status + blockers |
| [`docs/setup.md`](docs/setup.md) | Local setup |
| [`docs/convex-env-setup.md`](docs/convex-env-setup.md) | Convex environment variables |
| [`docs/deployment.md`](docs/deployment.md) | Preview / production deploy |
| [`docs/operations-runbook.md`](docs/operations-runbook.md) | Failed events, replay, renew, retention |
| [`docs/remaining-blockers.md`](docs/remaining-blockers.md) | Genuine launch blockers |

## Quick start

```bash
pnpm install
npx convex dev --once
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000
# ensure NEXT_PUBLIC_SITE_URL=http://localhost:3000 in .env.local
pnpm dev
```

Open http://localhost:3000 → sign up → test orgs are seeded with **outbound dry-run**.

## Operator surfaces

- `/inbox` — association reviews, notifications
- `/pov` — seller PDF proof-of-value (dry-run)
- `/schedules` — schedules (disabled by default)
- `/connections` — MOCK/live credential refs, renew/reconnect
- `/ops` — failed events, safe replay, unknown outbound, retention

## Safety

- Missing provider credentials → clearly labeled **MOCK** paths.
- Credentials present but `ALLOW_LIVE_OUTBOUND` unset → **DRY-RUN**.
- Never treat mocks as live integrations.
- Do not run live provider smoke or enable production automation without explicit authorization. See the operations runbook for the authorized procedure.

## Package pins

Critical: `better-auth@1.6.15` (peer of `@convex-dev/better-auth@0.12.5` requires `<1.7.0`). See architecture doc for the full matrix.

## Verify

```bash
pnpm typecheck && pnpm lint && pnpm build
npx convex codegen
```
