# Implementation status

Last updated: Phase 3 complete (local Convex); connectors/documents browser smoke 22/22.

## Phase summary

| Phase | Status | Notes |
|---|---|---|
| 0 — Discovery & compatibility | **Complete** | Pins documented; `.env.example` + `docs/convex-env-setup.md` |
| 1 — Authenticated workspace | **Complete (local)** | Better Auth, orgs/memberships, permissions, dashboard/deals/runs |
| 2 — Durable agent slice | **Complete (local)** | Web assignment → event/run → Workflow → read-only tool → bounded agent → result → live UI; cancel/resume/usage |
| 3 — Connectors & documents | **Complete (local / MOCK default)** | Connections UI, Box file path (Composio when keyed), PDF citations, GHL read/propose/approve/dry-run |
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

## Phase 3 deliverables

- [x] Connection onboarding UI (`/connections`) with labeled **MOCK** connect + live Composio credential-ref attach
- [x] Schema: `connections`, `documents`, `documentChunks`, `approvals`, `outboundActions`
- [x] Typed Box `FileSource` wrappers; Composio tools verified: `BOX_LIST_ITEMS_IN_FOLDER`, `BOX_DOWNLOAD_FILE` (toolkit `20260826_00`)
- [x] Real file source path: Box via Composio when `COMPOSIO_API_KEY` + managed ref; otherwise MOCK fixture files
- [x] PDF ingestion with page citations (`pdf-parse`); OCR fallback clearly labeled **MOCK OCR**
- [x] GHL read tools (`getContact`, `listOpportunities`) + `proposeUpdate` → approval → dry-run execute
- [x] No live CRM writes (fails closed even if `ALLOW_LIVE_CRM_WRITES=true`)
- [x] Fixtures documented: denied scopes, pagination, expired auth, cross-deal retrieval (`tests/phase3/fixtures.md`)
- [x] `docs/provider-capabilities.md` + this status file updated
- [x] MOCK browser smoke — Connections / Documents / Approvals dry-run (22/22)
- [ ] Live Composio/GHL smoke — **blocked** without credentials

### Phase 3 verification commands

- `pnpm typecheck` — pass
- `pnpm lint` — pass
- `npx convex codegen` / Convex tsc — pass
- `pnpm build` — pass
- `node tests/phase3/mock-adapters.test.mjs` — pass
- Browser smoke — pass (screenshots in Project store `media/phase3-*`)

### Phase 3 design notes

- Provider logic lives in adapters (`convex/lib/providers/*` + `*Actions.ts` with `"use node"`).
- Business tools (`documents.*`, `crm.*`, `approvals.*`) enforce org auth and never accept client-supplied authority for CRM writes.
- Approval payload is hashed; execute requires prior approve and defaults to dry-run via org `outboundDryRun`.

## Credential / setup blockers

| Item | Why needed | Exact setup |
|---|---|---|
| GitHub repo + `gh` auth | Open PR / push branch | Create empty GitHub repo; `gh auth login`; add `origin`; push `cursor/phase-3-connectors-f2cf` |
| Convex cloud project (optional) | Shared dashboard, webhooks | See `docs/convex-env-setup.md` |
| `BETTER_AUTH_SECRET` | Auth crypto | `npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)` |
| `SITE_URL` | Better Auth base URL | `npx convex env set SITE_URL http://localhost:3000` |
| `USE_AI_GATEWAY=true` + gateway creds | Live models (optional) | Configure Convex AI Gateway, then `npx convex env set USE_AI_GATEWAY true` |
| `COMPOSIO_API_KEY` | Live Box via Composio | `npx convex env set COMPOSIO_API_KEY ...` then attach connected account id in UI |
| `GHL_API_KEY` + `GHL_LOCATION_ID` | Live GHL reads | `npx convex env set GHL_API_KEY ...` / `GHL_LOCATION_ID ...` |
| `REDIS_URL` | Phase 4 Chat SDK | Provision Upstash/Redis Cloud; set on Vercel |
| AgentMail / Twilio | Phase 4 | Placeholders in `.env.example`; keep `ALLOW_LIVE_OUTBOUND` unset |
| OCR vendor | Scanned PDF quality | Keep MOCK OCR until vendor chosen |

## Next up (Phase 4)

AgentMail + Twilio/Chat SDK + Redis state; seller PDF proof-of-value flow with approval consumption and notifications. Keep CRM/email outbound dry-run until authorized.
