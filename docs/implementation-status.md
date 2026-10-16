# Implementation status

Last updated: Phase 5 complete (local Convex); schedules/subagents browser smoke 5/5.

## Phase summary

| Phase | Status | Notes |
|---|---|---|
| 0 — Discovery & compatibility | **Complete** | Pins documented; `.env.example` + `docs/convex-env-setup.md` |
| 1 — Authenticated workspace | **Complete (local)** | Better Auth, orgs/memberships, permissions, dashboard/deals/runs |
| 2 — Durable agent slice | **Complete (local)** | Web assignment → event/run → Workflow → read-only tool → bounded agent → result → live UI |
| 3 — Connectors & documents | **Complete (local / MOCK default)** | Box/GHL/PDF citations; dry-run approvals |
| 4 — Email/SMS POV flow | **Complete (local / MOCK default)** | AgentMail, Chat SDK, POV dry-run, outbound ledger |
| 5 — Schedules & subagents | **Complete (local / disabled default)** | Schedules + DST wall-clock, event rules, coordinator→specialist tree |
| 6 — Launch readiness | Not started | |

## Phase 5 deliverables

- [x] Configurable schedules (`convex/schedules.ts`, `scheduleJobs.ts`) — TZ default America/New_York, DST wall-clock policy documented, enable/disable, next-run preview, manual run, missed-run + concurrency policies (default no overlap)
- [x] Deterministic occurrence keys; transactional cancel/reschedule via `ctx.scheduler.cancel` + re-arm
- [x] Event rules → durable runs (`convex/eventRules.ts`)
- [x] Coordinator delegation → specialist run tree (`delegation.ts`, `coordinatorWorkflow`, `specialistWorkflow`) with bounded parallelism, depth/child limits, no recursive delegation by default
- [x] Cancellation propagation (`runs.requestCancel` tree walk + `delegation.cancelTree`)
- [x] Failed optional child → partial result with `missingWorkJson`
- [x] Fixtures: `tests/phase5/schedules.test.mjs` + `fixtures.md` (DST, duplicate occurrences, failed child, budget exhaustion)
- [x] UI `/schedules`; run detail child tree
- [x] Docs + handoff `internal/phase-5-handoff.md`
- [ ] Live schedule enable in shared env — **blocked** / not authorized (dev default disabled)
- [ ] GitHub PR — **blocked**: no repository remote

### Phase 5 verification commands

- `pnpm typecheck` / `pnpm lint` / `pnpm build` / `npx convex codegen` — pass
- `node tests/phase5/schedules.test.mjs` — pass
- Browser smoke — 5/5 (screenshots + recording in Project store `media/phase5-*`)

### Phase 5 design notes

- Schedules stay **disabled** until org `settings.schedulesEnabled=true` and the schedule is enabled.
- Recurrence uses local wall-clock in IANA TZ (not fixed UTC offsets).
- Chat SDK / email / CRM outbound remain dry-run; schedule runners produce MOCK summaries only.
- Convex Workflow remains the orchestrator for schedule + coordinator + specialist runs.

## Credential / setup (Phase 5)

No new external credentials. Optional admin action in UI:

1. `/schedules` → **Enable org schedules (dev)** (sets `schedulesEnabled`)
2. Create schedule → **Enable** individual schedule → or **Run now** (manual, works even when schedule disabled)

Keep `ALLOW_LIVE_OUTBOUND` unset.

## Next up (Phase 6)

Launch readiness — real-integration POV, permission boundary tests, production checklist.
