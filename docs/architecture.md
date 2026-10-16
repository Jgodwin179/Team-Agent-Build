# Architecture — Team Agent Platform

## Stack (locked)

| Responsibility | Choice | Package pins (Phase 0) |
|---|---|---|
| Web + webhooks | Next.js 15 (App Router) on Vercel | `next@15.5.28` |
| Auth | Better Auth via Convex component | `better-auth@1.6.15`, `@convex-dev/better-auth@0.12.5` |
| App data | Convex | `convex@1.47.0` |
| Agent threads | Convex Agent component | `@convex-dev/agent@0.7.8` |
| Durable orchestration | Convex Workflow (+ Workpool) | `@convex-dev/workflow@0.4.10`, `@convex-dev/workpool@0.4.14` |
| Models | Vercel AI Gateway via Convex provider | `ai@7.0.142`, `@convex-dev/ai-sdk-provider@0.3.0` |
| Chat channels | Vercel Chat SDK | `chat@4.42.0`, `@chat-adapter/twilio@4.42.0` |
| Chat SDK state | Redis adapter (prod); memory (local mock only) | `@chat-adapter/state-redis@4.42.0`, `@chat-adapter/state-memory@4.42.0` |

## Compatibility decisions

1. **Better Auth version pin** — `@convex-dev/better-auth@0.12.5` peer range is `better-auth >=1.6.11 <1.7.0`. Do **not** upgrade to Better Auth 1.7.x until the Convex component peer range allows it. Pin: `better-auth@1.6.15`.

2. **Agent / Workflow peers** — Both require `convex ^1.46.0` and `convex-helpers ^0.1.127`. Pinned `convex@1.47.0` and `convex-helpers@0.1.128`.

3. **AI SDK** — Agent component peers `ai ^7.0.0` and `@ai-sdk/provider ^4`. Use `convexGateway("provider/model")` from `@convex-dev/ai-sdk-provider` inside Convex actions. Configure AI Gateway credentials on the **Convex** deployment separately from the Vercel project.

4. **Chat SDK vs Convex** — Chat SDK is transport only. Redis holds subscriptions/locks/cache. Convex owns runs, schedules, business history, approvals. Do not put durable task state in Redis.

5. **No substitute orchestration** — Do not introduce Vercel Workflow, Durable Objects, or Hermes as the primary orchestrator. If a concrete incompatibility appears, document it in `implementation-status.md` before changing course.

## Runtime split

- **Vercel (Next.js):** UI, SSR auth helpers, webhook ingress routes that verify signatures then persist via Convex mutations/actions, Chat SDK webhook handlers.
- **Convex:** Schema, permissions, Better Auth HTTP routes (proxied through Next `/api/auth`), Agent/Workflow components, scheduled jobs, durable run state.
- **Redis:** Chat SDK operational state only (`REDIS_URL`).

## Auth & tenancy

- Better Auth authenticates users; organization memberships authorize data access.
- Client-supplied `organizationId` is a **selector**, never authority. Every public Convex function uses `requireOrgAccess` (see `convex/lib/permissions.ts`).
- Roles: `owner` | `admin` | `member` | `viewer`. Viewers are read-only.
- Dev default: test orgs with `outboundDryRun: true` and `isTestOrganization: true`.

## Event / run model (Phase 2+)

Ingress → verify → persist `inboundEvents` (dedupe) → workflow → agent steps → approval → outbound ledger. Run statuses: `queued`, `running`, `waiting_for_approval`, `waiting_for_external`, `succeeded`, `failed`, `cancel_requested`, `canceled`.

## Schedules & delegation (Phase 5)

- Schedules persist in Convex with IANA timezone (default `America/New_York`), wall-clock recurrence, missed-run + concurrency policies, and deterministic occurrence keys.
- Next fire is armed with `ctx.scheduler.runAt`; disable/reschedule cancels the prior job then re-arms.
- Org `settings.schedulesEnabled` defaults **false** in development.
- Coordinator runs spawn bounded specialist children (`parentRunId` tree); cancel propagates; optional child failure yields a partial result with `missingWorkJson`.

## Launch readiness (Phase 6)

- **Ops queue** (`convex/ops.ts`, `/ops`): failed inbound + failed runs; admin safe replay (resume or restart; preserves provider event id).
- **Connection renew/reconnect**: `watchExpiresAt` / `renewAfterAt`, `listNeedingAttention`, acknowledge reconnect (no invented OAuth).
- **Outbound unknown reconcile** (`convex/reconcile.ts`): operator mark sent/failed/dry-run; cron folds dry-run unknowns only — never auto-resend.
- **Schedule reconcile**: cron every 15m + manual `/ops` trigger; uses occurrence-key dedupe.
- **Retention**: preview + bounded purge for audit/usage/succeeded inbound only; daily cron. Ledger/docs/deals never auto-deleted.
- Crons registered in `convex/crons.ts`.

## Directory map

```
app/ or src/app/     Next.js pages + auth proxy routes
components/          UI shell
convex/              schema, auth, orgs, deals, runs, ops, retention, reconcile, crons
src/lib/providers/   EmailProvider etc. (mock/dry-run/live)
src/lib/channels/    Chat SDK health / future bot wiring
docs/                architecture, capabilities, status, setup, deploy, runbook
```

## Development deployment

This cloud agent uses a **local Convex backend** (`npx convex dev` without login) at `http://127.0.0.1:3210`. For shared cloud deployments, see `docs/convex-env-setup.md`.
