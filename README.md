# Team Agent Platform

Private multi-tenant agent workspace for business brokerage / M&A teams.

See the product brief in the Project store and:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/provider-capabilities.md`](docs/provider-capabilities.md)
- [`docs/implementation-status.md`](docs/implementation-status.md)
- [`docs/convex-env-setup.md`](docs/convex-env-setup.md)

## Quick start

```bash
pnpm install
npx convex dev --once
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000
# ensure NEXT_PUBLIC_SITE_URL=http://localhost:3000 in .env.local
pnpm dev:frontend
# in another terminal, keep Convex watching:
pnpm convex:dev
```

Or `pnpm dev` to run frontend + Convex together (requires `npm-run-all`).

Open http://localhost:3000 → sign up → test orgs are seeded with **outbound dry-run**.

## Safety

- Missing provider credentials → clearly labeled **MOCK** paths.
- Credentials present but `ALLOW_LIVE_OUTBOUND` unset → **DRY-RUN**.
- Never treat mocks as live integrations.

## Package pins

Critical: `better-auth@1.6.15` (peer of `@convex-dev/better-auth@0.12.5` requires `<1.7.0`). See architecture doc for the full matrix.
