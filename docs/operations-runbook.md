# Operations runbook

## Mode banners

UI Mode banner reflects `outboundDryRun` and `isTestOrganization`. Treat MOCK / DRY-RUN as non-production.

## Failed inbound events

1. Open `/ops` → Failed inbound.
2. Inspect `errorMessage`, provider event id, attempts.
3. Admin → **Safe replay**:
   - Resumes failed run workflow when `workflowId` exists.
   - Otherwise starts a new assignment workflow linked to the same provider event id (dedupe preserved).
4. Replay never invents a new provider event id and remains gated by dry-run/MOCK.

Fixture: **Seed MOCK failure** on `/ops`.

## Unknown outbound

Ledger state after a send timeout with possible provider acceptance.

1. `/ops` → Unknown outbound.
2. Check provider console (AgentMail / Twilio / GHL) for the external id.
3. Resolve **without resending**:
   - Mark sent — delivery confirmed
   - Mark failed — no delivery; a new proposal may be created later
   - Mark dry-run — only for `dryRun=true` rows
4. Cron folds dry-run unknowns hourly; **live unknowns stay for operators**.

## Connection renew / reconnect

1. `/connections` or `/ops` → Needs attention.
2. Expired OAuth / revoked scopes → **Needs reconnect**, attach managed credential ref, **Acknowledge reconnect**.
3. Watch/subscription window → **Set renew +7d** (records `watchExpiresAt` / `renewAfterAt`). Live watch renewal APIs require provider credentials and are not auto-called without auth.

## Retention / deletion

Safe auto-purge targets only:

- `auditEvents`
- `usageRecords`
- `inboundEvents` with status `succeeded`

Never auto-deleted: runs, approvals, outbound ledger, documents, deals, connections, schedules, failed inbound.

Workflow:

1. `/ops` → Retention preview (candidate counts).
2. **Preview purge batch** (`execute=false`).
3. **Execute purge batch** only after confirm (admin).
4. Daily cron runs bounded purge across active orgs.

Configure days via `retention.updateRetentionSettings` (min 7).

## Schedule missed transitions

- Cron every 15 minutes for orgs with `schedulesEnabled=true`.
- Manual: `/ops` → Run reconcile now (admin).
- Uses occurrence keys — duplicate fires are skipped.
- Schedules remain disabled by default in development.

## Live provider smoke (document only — do not run without auth)

```bash
# 1) Attach credentials on Convex (see setup.md)
# 2) Keep ALLOW_LIVE_OUTBOUND unset for dry-run rehearsal
# 3) With explicit authorization only:
npx convex env set ALLOW_LIVE_OUTBOUND true
# 4) Use authorized test inbox / phone / GHL sandbox location
# 5) Run POV from /pov against test deal + test PDF
# 6) Unset ALLOW_LIVE_OUTBOUND immediately after smoke
npx convex env unset ALLOW_LIVE_OUTBOUND
```

## Escalation signals

| Signal | Action |
|---|---|
| Spike in failed inbound | Check webhook signatures + provider status; replay after fix |
| Live unknown outbound | Provider reconcile; never double-send |
| needs_reconnect | Rotate managed credential; ack |
| Schedule miss storm | Confirm org TZ + cron; run reconcile; check occurrence history |
