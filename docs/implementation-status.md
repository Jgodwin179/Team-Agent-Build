# Implementation status

Last updated: Phase 0 + Phase 1 complete (local Convex); UI smoke test passed.

## Phase summary

| Phase | Status | Notes |
|---|---|---|
| 0 — Discovery & compatibility | **Complete** | Pins documented; `.env.example` + `docs/convex-env-setup.md`; architecture + capability docs written |
| 1 — Authenticated workspace | **Complete (local)** | Better Auth, orgs/memberships, permissions, dashboard/deals/runs UI, test org seed, dry-run banner |
| 2 — Durable agent slice | Not started | Packages installed/registered in `convex.config.ts` only |
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
- [ ] Automated integration tests for two-org isolation / viewer writes / revoke (manual checklist below)
- [ ] GitHub PR — **blocked**: no repository attached to this agent run; `gh` not authenticated

### Manual verification checklist (Phase 1)

1. Sign up user A → auto-seed attaches to both test orgs as owner.
2. Create a deal in org A; confirm it appears only for that org selector.
3. Call `deals.get` / `runs.get` with another org’s ID → expect null/unauthorized.
4. Set membership to `viewer` → create deal/run should fail with role error.
5. Revoke membership → subsequent org queries deny access.
6. Banner shows MOCK/DRY-RUN; no live email/SMS attempted.

## Credential / setup blockers

| Item | Why needed | Exact setup |
|---|---|---|
| GitHub repo + `gh` auth | Open PR / push branch | Create empty GitHub repo; `gh auth login`; add `origin`; push `cursor/phase-0-1-workspace-f2cf` |
| Convex cloud project (optional) | Shared dashboard, webhooks | See `docs/convex-env-setup.md` — local anonymous backend works for Phase 1 |
| `BETTER_AUTH_SECRET` | Auth crypto | `npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)` |
| `SITE_URL` | Better Auth base URL | `npx convex env set SITE_URL http://localhost:3000` |
| AI Gateway creds on Convex | Phase 2 model calls | Configure per Convex AI Gateway docs on the **Convex** deployment |
| `REDIS_URL` | Phase 4 Chat SDK | Provision Upstash/Redis Cloud; set on Vercel |
| AgentMail / Twilio / Composio / GHL | Phases 3–4 | Placeholders in `.env.example`; keep `ALLOW_LIVE_OUTBOUND` unset |

## Next up (Phase 2)

Web assignment → `inboundEvents`/`runs` → Workflow → bounded Agent → read-only tool → result → live UI subscription; limits, cancel, usage tracking.
