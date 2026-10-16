# Implementation status

Last updated: Phase 2 complete (local Convex); durable assignment smoke passed.

## Phase summary

| Phase | Status | Notes |
|---|---|---|
| 0 — Discovery & compatibility | **Complete** | Pins documented; `.env.example` + `docs/convex-env-setup.md` |
| 1 — Authenticated workspace | **Complete (local)** | Better Auth, orgs/memberships, permissions, dashboard/deals/runs |
| 2 — Durable agent slice | **Complete (local)** | Web assignment → event/run → Workflow → read-only tool → bounded agent → result → live UI; cancel/resume/usage |
| 3 — Connectors & documents | Not started | |
| 4 — Email/SMS POV flow | Not started | Mock EmailProvider + Chat SDK health stubs only |
| 5 — Schedules & subagents | Not started | |
| 6 — Launch readiness | Not started | |

## Phase 0 deliverables

- [x] `docs/architecture.md`
- [x] `docs/provider-capabilities.md`
- [x] `docs/implementation-status.md` (this file)
- [x] `.env.example` (placeholders only)
- [x] `docs/convex-env-setup.md`
- [x] Pinned lockfile (`pnpm-lock.yaml`)
- [x] Compatibility verified from official docs + installed types

### Key pin

`better-auth@1.6.15` (must stay `<1.7.0` for `@convex-dev/better-auth@0.12.5`).

## Phase 1 deliverables

- [x] Better Auth (email/password) via `@convex-dev/better-auth`
- [x] Organizations + memberships with roles `owner|admin|member|viewer`
- [x] Server-side `requireOrgAccess` / role helpers
- [x] Dashboard, deals list/create, runs list/queue/cancel-request
- [x] Dev seed: Demo Brokerage + Peer Firm test orgs, outbound dry-run ON
- [x] UI banner labeling mock/dry-run when credentials missing
- [x] Manual UI smoke (sign-up, deals, runs, MOCK banner)
- [ ] Automated integration tests for two-org isolation / viewer writes / revoke
- [ ] GitHub PR — **blocked**: no repository attached; `gh` not authenticated

## Phase 2 deliverables

- [x] `assignments.submit` — web assignment → deduped `inboundEvents` → `runs` → Workflow start
- [x] Durable `assignmentWorkflow` steps: markRunning → ensureThread → `listOrgDeals` (read-only) → agent brief → persist → succeed
- [x] Bounded agent (`maxSteps` / `stepCountIs`) with labeled **MOCK** model by default (`mockModel`)
- [x] Optional gateway via Convex env `USE_AI_GATEWAY=true` (not enabled locally)
- [x] Idempotent tool ledger (`toolExecutions` by `runId+stepKey`) for resume safety
- [x] Usage tracking (`usageRecords`) + token budget check
- [x] Cancel (`requestCancel` + workflow cancel) and resume (`resumeFailed` → workflow restart / journal replay)
- [x] Live UI: `/assignments`, `/runs/[runId]` (status, result, tools, usage)
- [x] Manual smoke: submit “Phase 2 Durable Brief” → succeeded + MOCK result + listOrgDeals + usage

### Phase 2 verification commands

- `pnpm typecheck` — pass
- `pnpm lint` — pass
- `npx tsc -p convex/tsconfig.json --noEmit` — pass
- `pnpm build` — pass
- Browser smoke — pass (screenshots in Project store `media/phase2-*`)

### Phase 2 design notes

- Read-only tool runs as an explicit durable workflow mutation step (idempotent), then the agent consumes its JSON in-prompt. This keeps resume semantics clean and avoids Agent+tool typing cycles under tsc.
- Default model is **MOCK**; never presented as live LLM.

## Credential / setup blockers

| Item | Why needed | Exact setup |
|---|---|---|
| GitHub repo + `gh` auth | Open PR / push branch | Create empty GitHub repo; `gh auth login`; add `origin`; push `cursor/phase-0-1-workspace-f2cf` |
| Convex cloud project (optional) | Shared dashboard, webhooks | See `docs/convex-env-setup.md` |
| `BETTER_AUTH_SECRET` | Auth crypto | `npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)` |
| `SITE_URL` | Better Auth base URL | `npx convex env set SITE_URL http://localhost:3000` |
| `USE_AI_GATEWAY=true` + gateway creds | Live models (Phase 2 optional) | Configure Convex AI Gateway, then `npx convex env set USE_AI_GATEWAY true`. Default remains MOCK. |
| `REDIS_URL` | Phase 4 Chat SDK | Provision Upstash/Redis Cloud; set on Vercel |
| AgentMail / Twilio / Composio / GHL | Phases 3–4 | Placeholders in `.env.example`; keep `ALLOW_LIVE_OUTBOUND` unset |

## Next up (Phase 3)

Connection onboarding, one real file source, PDF ingestion with citations, GHL read/proposed-update tools.
