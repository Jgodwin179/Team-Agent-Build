# Remaining blockers (genuine)

Do **not** treat MOCK or dry-run passes as live integration completion.

| Blocker | Why it blocks launch | Unblock |
|---|---|---|
| No GitHub `origin` remote | Cannot open PR / CI | Attach repo, `git remote add origin …`, push, `gh pr create` |
| No Vercel preview project linked in this environment | Cannot deploy preview URL | Create/link Vercel project; set `NEXT_PUBLIC_*` |
| Live provider credentials not authorized | Box/Drive/Gmail/Calendar/GHL/AgentMail/Twilio remain MOCK or dry-run | Supply test-account credentials; keep `ALLOW_LIVE_OUTBOUND` unset until authorized |
| `ALLOW_LIVE_OUTBOUND` unset (intentional) | No live email/SMS/CRM writes | Explicit user authorization + test recipients only |
| Chat SDK Redis not configured | Local memory adapter only (not prod-safe) | Set `REDIS_URL` for preview/prod |
| AI Gateway keys on Convex optional | Agent steps use MOCK summaries without gateway | Configure Convex AI Gateway env |
| Org schedules disabled by default | No automatic schedule fires until admin enables | `/schedules` → enable org + schedule after policy review |
| Live watch renewal not auto-called | Renew surfaces record windows; provider watch APIs need live OAuth | Authorize Composio/provider watch renewal in Phase go-live |
| Authorized live POV smoke not run | E2E proof-of-value against real providers not proven | Follow runbook “Live provider smoke” with authorization |
| Better Auth production secret / SITE_URL | Preview/prod must match deployed URL | Set per environment before sharing |

## Explicitly not blockers for local dry-run

- Phase 0–6 code paths for dry-run POV, schedules, ops replay, retention preview
- Typecheck / lint / build (must stay green locally)
