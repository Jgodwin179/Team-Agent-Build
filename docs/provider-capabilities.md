# Provider capability matrix

Status legend: **Verified** (docs + package types inspected), **Planned** (Phase N), **Mock** (interface + labeled mock only), **Blocked** (needs credentials/account).

## Core platform

| Provider | Capability | Status | Notes |
|---|---|---|---|
| Better Auth + Convex | Email/password sessions, JWT for Convex | Verified | NPM component `@convex-dev/better-auth`; Next.js proxy via `convexBetterAuthNextJs` |
| Convex Agent | Threads, generateText, tools | Verified | Phase 2; `Agent` class from `@convex-dev/agent` |
| Convex Workflow | Durable multi-step | Verified | Phase 2; `WorkflowManager` / `defineWorkflow` from `@convex-dev/workflow` |
| Vercel AI Gateway | Model access from Convex | Verified (deps) | `convexGateway` from `@convex-dev/ai-sdk-provider`; needs Convex env credentials |
| Chat SDK Redis state | Subscriptions, locks | Verified (deps) | `createRedisState` from `@chat-adapter/state-redis`; requires `REDIS_URL` |
| Chat SDK Twilio | SMS channel | Verified + wired (MOCK default) | `@chat-adapter/twilio@4.42.0` via `src/lib/channels/bot.ts`; transport only |
| Chat SDK memory state | Local-only | Verified | `@chat-adapter/state-memory` — **mock/dev only**, not production |

## Email / SMS

| Provider | Operations needed | Status | Env |
|---|---|---|---|
| AgentMail | Provision inbox, receive/send, attachments, thread IDs | **Implemented** (MOCK/dry-run default) | `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`; live send only if `ALLOW_LIVE_OUTBOUND=true` |
| Twilio / Chat SDK | SMS inbound webhooks, signature verify, opt-out, staff secure-link alerts | **Implemented** (MOCK without Redis+Twilio) | `TWILIO_*`, `REDIS_URL`, `TWILIO_WEBHOOK_URL` |

Outbound default: **dry-run**. Live sends require `ALLOW_LIVE_OUTBOUND=true` **and** explicit authorization. Never describe MOCK as live.

## Connectors (Phase 3)

| Provider | Needed ops | Composio default? | Verification status |
|---|---|---|---|
| Box | list folder, download, metadata | Yes | **Verified (docs)** toolkit slug `BOX`, version `20260826_00`; tools `BOX_LIST_ITEMS_IN_FOLDER`, `BOX_DOWNLOAD_FILE`, `BOX_GET_FILE_INFORMATION`. Live path behind typed wrappers when `COMPOSIO_API_KEY` + connected account ref attached. Default local path is **MOCK**. |
| Google Drive | same as Box | Yes | Planned — interface reserved on Connections UI; not wired this slice |
| Gmail | search/read, attachments, drafts, authorized send | Yes / direct if gaps | Planned (Phase 4+) |
| Google Calendar | availability, create/update/cancel under policy | Yes | Planned (Phase 5+) |
| GoHighLevel (GHL) | contacts/opportunities, notes, allowed field/stage updates | Direct API (+ Composio later if needed) | **Verified (docs)** scopes `contacts.readonly` / `contacts.write`, `opportunities.readonly` / `opportunities.write`; notes via `POST /contacts/:id/notes`; opportunities search `POST /opportunities/search`; host `https://services.leadconnectorhq.com`. App implements read + propose → approval → **dry-run execute only**. |

### Box / Composio notes (verified)

- Composio-managed OAuth available for toolkit `BOX` (docs.composio.dev/toolkits/box).
- Pagination: `limit` + `offset` or marker (`usemarker` + `marker`) on `BOX_LIST_ITEMS_IN_FOLDER`.
- Direct tool execute requires toolkit version pin or `dangerouslySkipVersionCheck` when using `"latest"` — this app pins `20260826_00`.
- Do **not** store OAuth tokens in Convex rows; store Composio `connectedAccountId` as `managedCredentialRef`.

### GHL notes (verified)

- Scopes are independent: write does not imply read ([HighLevel Scopes](https://marketplace.gohighlevel.com/docs/Authorization/Scopes)).
- Phase 3 allowlisted opportunity patch fields: `name`, `status`, `pipelineStageId`, `monetaryValue`.
- Live CRM writes remain disabled even if `ALLOW_LIVE_CRM_WRITES=true` (fails closed with message).
- Delivery ownership: `channelIdentities.smsDeliveryOwner` is `twilio | ghl` — never both for the same conversation. POV staff alerts use Twilio/Chat SDK path (dry-run).

## Documents / OCR (Phase 3)

| Concern | Status |
|---|---|
| Private Convex file storage abstraction | **Implemented** — `ctx.storage` via document ingest |
| PDF text extraction | **Implemented** — pluggable `pdf-parse` extractor in `documentActions` |
| OCR fallback | **Mock** — labeled `MOCK OCR` when no text layer / no OCR vendor |
| Page-aware chunks + citations | **Implemented** — `documentChunks` with `p.N` citations |
| Bounded worker/sandbox for heavy OCR/artifacts | Planned (Phase 5/6) |

## Unresolved requirements

1. AI Gateway / Convex credential form for this org (API key vs OIDC) — set on Convex env, not only Vercel.
2. AgentMail inbox provisioning API details for one-inbox-per-org.
3. Twilio sender registration / A2P consent for production SMS.
4. Live Composio Box connected account for this environment (optional; MOCK works locally).
5. Live GHL location token for read smoke (optional; MOCK works locally).
6. Managed Redis (Upstash/Redis Cloud) for Chat SDK in preview/prod.
7. GitHub remote for this project — none attached to the agent run (blocks PR open until a remote exists).
8. Production OCR vendor selection after testing representative scanned PDFs.
