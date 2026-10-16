# Implementation status

Last updated: Phase 4 complete (local Convex); POV browser smoke 7/7 after inbox validator fix.

## Phase summary

| Phase | Status | Notes |
|---|---|---|
| 0 — Discovery & compatibility | **Complete** | Pins documented; `.env.example` + `docs/convex-env-setup.md` |
| 1 — Authenticated workspace | **Complete (local)** | Better Auth, orgs/memberships, permissions, dashboard/deals/runs |
| 2 — Durable agent slice | **Complete (local)** | Web assignment → event/run → Workflow → read-only tool → bounded agent → result → live UI; cancel/resume/usage |
| 3 — Connectors & documents | **Complete (local / MOCK default)** | Connections UI, Box file path (Composio when keyed), PDF citations, GHL read/propose/approve/dry-run |
| 4 — Email/SMS POV flow | **Complete (local / MOCK default)** | AgentMail EmailProvider, Chat SDK+Redis (memory MOCK), POV workflow, outbound ledger, inbox, fixtures |
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

## Phase 1–3

See prior sections in git history / handoffs (`internal/phase-*-handoff.md`). Deliverables remain complete locally; live Composio/GHL smoke still blocked without credentials.

## Phase 4 deliverables

- [x] AgentMail behind `EmailProvider` (`src/lib/providers/email.ts`) — MOCK when `AGENTMAIL_API_KEY` missing; dry-run when keyed but `ALLOW_LIVE_OUTBOUND` unset; live adapter only when allow-listed
- [x] Twilio / Chat SDK with Redis state adapter (`src/lib/channels/{chat,bot}.ts`) — memory state when Redis/Twilio missing; never claim live
- [x] Webhooks: `/api/webhooks/agentmail`, `/api/webhooks/twilio` with signature validation
- [x] Seller PDF POV dry-run E2E (`convex/pov.ts`, `workflows/povWorkflow.ts`): email PDF → association (ambiguous → review) → document extract → GHL propose → inbox + SMS dry-run secure link → approve → execute dry-run
- [x] Outbound ledger: `proposed → approved → claimed → sending → dry_run|sent|failed|unknown`; atomic approval consumption (`outbound.claimForExecution`)
- [x] UI: `/inbox`, `/pov`; ModeBanner shows email/SMS/Chat health
- [x] Fixtures: `tests/phase4/fixtures.md` + `tests/phase4/communications.test.mjs` (duplicate delivery, repeated approval, invalid signatures, ambiguous send, fuzzy association)
- [x] Docs updated; handoff at Project store `internal/phase-4-handoff.md`
- [x] MOCK browser smoke — ModeBanner / POV / inbox / approve / dry-run execute / repeat-click / ledger (7/7)
- [ ] Live AgentMail/Twilio/Redis smoke — **blocked** without credentials + explicit `ALLOW_LIVE_OUTBOUND`
- [ ] GitHub PR — **blocked**: no repository remote / `gh` auth

### Phase 4 verification commands

- `pnpm typecheck` — pass
- `pnpm lint` — pass
- `npx convex codegen` — pass
- `pnpm build` — pass
- `node tests/phase4/communications.test.mjs` — pass
- Browser smoke — 7/7 (screenshots + recording in Project store `media/phase4-*`)

### Phase 4 design notes

- Chat SDK is **transport only**; Convex owns runs/workflows/approvals.
- SMS staff alerts contain secure links only (no deal content in SMS body).
- `channelIdentities.smsDeliveryOwner` is exclusive `twilio | ghl`.
- Fuzzy deal name match never auto-associates — opens `associationReviews`.

## Credential / setup blockers

| Item | Why needed | Exact setup |
|---|---|---|
| GitHub repo + `gh` auth | Open PR / push branch | Create empty GitHub repo; `gh auth login`; add `origin`; push `cursor/phase-4-communications-f2cf` |
| Convex cloud project (optional) | Shared dashboard, webhooks | See `docs/convex-env-setup.md` |
| `BETTER_AUTH_SECRET` | Auth crypto | `npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)` |
| `SITE_URL` | Better Auth base URL | `npx convex env set SITE_URL http://localhost:3000` |
| `USE_AI_GATEWAY=true` + gateway creds | Live models (optional) | Configure Convex AI Gateway, then `npx convex env set USE_AI_GATEWAY true` |
| `COMPOSIO_API_KEY` | Live Box via Composio | `npx convex env set COMPOSIO_API_KEY ...` then attach connected account id in UI |
| `GHL_API_KEY` + `GHL_LOCATION_ID` | Live GHL reads | `npx convex env set GHL_API_KEY ...` / `GHL_LOCATION_ID ...` |
| `AGENTMAIL_API_KEY` | Live AgentMail | Next `.env.local` + `npx convex env set AGENTMAIL_API_KEY ...` |
| `AGENTMAIL_WEBHOOK_SECRET` | Signed inbound webhooks | Next + Convex env; local fixtures may use `X-AgentMail-Mock: true` when unset |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Chat SDK Twilio adapter | Next `.env.local` (webhook routes) + optional Convex mirror |
| `TWILIO_WEBHOOK_URL` | Signature base URL | Public URL of `/api/webhooks/twilio` |
| `REDIS_URL` | Chat SDK production state | Upstash/Redis Cloud; set on Vercel / Next |
| `ALLOW_LIVE_OUTBOUND=true` | Live email/SMS | **Only with explicit authorization** — keep unset in development |
| OCR vendor | Scanned PDF quality | Keep MOCK OCR until vendor chosen |

## Next up (Phase 5)

Schedules & subagents — durable schedules, specialist handoffs, policy gates. Keep CRM/email/SMS outbound dry-run until authorized.
