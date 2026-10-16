# Provider capability matrix

Status legend: **Verified** (docs + package types inspected), **Planned** (Phase N), **Mock** (interface + labeled mock only), **Blocked** (needs credentials/account).

## Core platform

| Provider | Capability | Status | Notes |
|---|---|---|---|
| Better Auth + Convex | Email/password sessions, JWT for Convex | Verified | NPM component `@convex-dev/better-auth`; Next.js proxy via `convexBetterAuthNextJs` |
| Convex Agent | Threads, generateText, tools | Verified (deps) | Execution in Phase 2; `Agent` class from `@convex-dev/agent` |
| Convex Workflow | Durable multi-step | Verified (deps) | Phase 2; `WorkflowManager` / `defineWorkflow` from `@convex-dev/workflow` |
| Vercel AI Gateway | Model access from Convex | Verified (deps) | `convexGateway` from `@convex-dev/ai-sdk-provider`; needs Convex env credentials |
| Chat SDK Redis state | Subscriptions, locks | Verified (deps) | `createRedisState` from `@chat-adapter/state-redis`; requires `REDIS_URL` |
| Chat SDK Twilio | SMS channel | Verified (package) | `@chat-adapter/twilio@4.42.0`; wiring Phase 4 |
| Chat SDK memory state | Local-only | Verified | `@chat-adapter/state-memory` — **mock/dev only**, not production |

## Email / SMS

| Provider | Operations needed | Status | Env |
|---|---|---|---|
| AgentMail | Provision inbox, receive/send, attachments, thread IDs | Mock | `AGENTMAIL_API_KEY` — live adapter Phase 4 |
| Twilio | SMS send, inbound webhooks, delivery status, opt-out | Mock | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, messaging credentials |

Outbound default: **dry-run**. Live sends require `ALLOW_LIVE_OUTBOUND=true` **and** explicit authorization.

## Connectors (Phase 3)

| Provider | Needed ops | Composio default? | Verification status |
|---|---|---|---|
| Box | list/search, download, metadata, upload, change ingest | Yes (preferred) | Not verified against live account — document OAuth scopes before coding workflows |
| Google Drive | same as Box | Yes | Same |
| Gmail | search/read, attachments, drafts, authorized send | Yes / direct if gaps | Same |
| Google Calendar | availability, create/update/cancel under policy | Yes | Recheck availability immediately before booking |
| GoHighLevel (GHL) | contacts/opportunities, notes, allowed field/stage updates, events | Direct or Composio | Must not double-send with Twilio; decide delivery owner per conversation |

Do **not** assume a listed Composio connector supports every trigger/file op. Confirm against current Composio + vendor docs with a test account before marking Verified.

## Documents / OCR (Phase 3)

| Concern | Status |
|---|---|
| Private Convex file storage abstraction | Planned |
| PDF text extraction provider selection | Planned — test text/scanned/mixed/encrypted/oversized before locking |
| Page-aware chunks + citations | Planned |
| Bounded worker/sandbox for heavy OCR/artifacts | Planned |

## Unresolved requirements

1. AI Gateway / Convex credential form for this org (API key vs OIDC) — set on Convex env, not only Vercel.
2. AgentMail inbox provisioning API details for one-inbox-per-org.
3. Twilio sender registration / A2P consent for production SMS.
4. GHL API scopes and whether notes/updates need separate OAuth apps.
5. Managed Redis (Upstash/Redis Cloud) for Chat SDK in preview/prod.
6. GitHub remote for this project — none attached to the agent run (blocks PR open until a remote exists).
