# Setup guide

## Prerequisites

- Node.js 20+
- pnpm
- Convex CLI (`npx convex`)

## Local install

```bash
pnpm install
cp .env.example .env.local   # if present; otherwise keep existing .env.local
npx convex dev --once
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000
# .env.local must include:
#   NEXT_PUBLIC_CONVEX_URL=<from convex>
#   NEXT_PUBLIC_SITE_URL=http://localhost:3000
pnpm dev
```

Open http://localhost:3000 → sign up. Dev seed creates test orgs with **outbound dry-run**.

## Convex environment (required)

See [`convex-env-setup.md`](./convex-env-setup.md). Minimum:

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | Auth signing |
| `SITE_URL` | Better Auth callback base |

## Optional provider credentials

Missing credentials keep **MOCK** adapters. Do not claim MOCK as live.

| Variable | Enables |
|---|---|
| `COMPOSIO_API_KEY` | Live Box (Composio) when connection has managed ref |
| `GHL_API_KEY`, `GHL_LOCATION_ID` | Live GHL reads; writes stay dry-run unless authorized |
| `AGENTMAIL_API_KEY` | Live AgentMail inbox |
| `TWILIO_*` + Chat SDK | Live SMS transport |
| `REDIS_URL` | Chat SDK Redis state (prod); memory used locally |
| AI Gateway keys on Convex | Live models; else MOCK agent summaries |
| `ALLOW_LIVE_OUTBOUND` | **Do not set** without explicit authorization |

## Safety defaults

- `organizations.outboundDryRun = true` for test orgs
- `settings.schedulesEnabled = false` until admin enables
- Failed-event replay starts dry-run-safe workflows only
- Retention purge defaults to dry-run preview

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm build
npx convex codegen
```
