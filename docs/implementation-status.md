# Implementation status

Last updated: Phase 6 complete (local Convex); live smoke **not** run (authorization required).

## Phase summary

| Phase | Status | Notes |
|---|---|---|
| 0 — Discovery & compatibility | **Complete** | Pins documented; `.env.example` + `docs/convex-env-setup.md` |
| 1 — Authenticated workspace | **Complete (local)** | Better Auth, orgs/memberships, permissions, dashboard/deals/runs |
| 2 — Durable agent slice | **Complete (local)** | Web assignment → event/run → Workflow → read-only tool → bounded agent → result → live UI |
| 3 — Connectors & documents | **Complete (local / MOCK default)** | Box/GHL/PDF citations; dry-run approvals |
| 4 — Email/SMS POV flow | **Complete (local / MOCK default)** | AgentMail, Chat SDK, POV dry-run, outbound ledger |
| 5 — Schedules & subagents | **Complete (local / disabled default)** | Schedules + DST wall-clock, event rules, coordinator→specialist tree |
| 6 — Launch readiness | **Complete (local / dry-run)** | Ops, replay, renew, retention, reconcile, production docs |

## Phase 6 deliverables

- [x] Monitoring / operator visibility — `convex/ops.ts`, `/ops` (failed inbound + failed runs + summary)
- [x] Failed-event safe replay — `ops.replayFailedInbound` (resume or restart; preserves provider event id)
- [x] Connection renewal / reconnect — schema fields, `listNeedingAttention`, Connections + Ops UI
- [x] Retention/deletion — `convex/retention.ts` preview + bounded execute; daily cron; safe tables only
- [x] Reconciliation — outbound unknown resolve + dry-run fold cron; schedule missed reconcile cron + manual
- [x] Production docs — README, setup, deployment, operations runbook; architecture/capabilities/status updated
- [x] Remaining blockers list — `docs/remaining-blockers.md` (no MOCK-as-live claims)
- [x] Live smoke procedure documented — **not executed** (needs explicit authorization)
- [ ] GitHub PR — **blocked**: no repository remote
- [ ] Preview deploy — **blocked**: no Vercel project / GitHub attach in this environment
- [ ] Authorized live provider smoke — **blocked**: awaiting user authorization + credentials

### Phase 6 verification commands

- `pnpm typecheck` / `pnpm lint` / `pnpm build` / `npx convex codegen`
- `node tests/phase6/ops.test.mjs` (if present)

### Phase 6 design notes

- Replay and reconcile never auto-resend outbound.
- Retention never auto-deletes runs, approvals, outbound ledger, documents, or deals.
- Crons are registered but do not enable live automation; `ALLOW_LIVE_OUTBOUND` stays unset.
- Schedules still require org `schedulesEnabled` before reconcile fires work.

## Credential / setup checklist (user next steps)

1. Attach GitHub remote → push `cursor/phase-6-launch-f2cf` → open PR
2. Link Vercel preview; set `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_SITE_URL`, Convex `SITE_URL`
3. Optional credentials (still dry-run): Composio, GHL, AgentMail, Twilio, Redis, AI Gateway
4. Keep `ALLOW_LIVE_OUTBOUND` unset until explicit authorization
5. After auth: follow `docs/operations-runbook.md` live smoke section with test recipients only

## Safety

Mocks and dry-run paths are labeled. Do not claim integrations complete because fixtures pass.
