# Phase 4 fixtures

Local-only scenarios. Never claim live email/SMS/CRM.

## Duplicate delivery

1. Open `/pov`, start a seller PDF dry-run.
2. Click **Replay duplicate delivery** (same `providerEventId` twice).
3. Expect second response `deduplicated=true` and the same `runId`.
4. Inbound table key: `organizationId + agentmail:message:{providerEventId}`.

## Repeated approval clicks

1. From POV flow (or Approvals), approve a pending GHL note.
2. Click **Dry-run execute** once → outbound `claimed → sending → dry_run`, approval `executed` + `consumedAt`.
3. Click **Dry-run execute** again → error: `Approval already claimed/consumed (repeated click ignored)`.
4. Ledger must not double-send.

## Invalid webhook signatures

### AgentMail

```bash
# Missing secret + no mock header → 503 MOCK/unconfigured
curl -s -o /tmp/am1.json -w "%{http_code}" -X POST http://localhost:3000/api/webhooks/agentmail \
  -H 'Content-Type: application/json' \
  -d '{"organizationId":"x","providerEventId":"e1"}'
# expect 503

# Invalid signature when secret set → 403
# AGENTMAIL_WEBHOOK_SECRET=testsecret
curl -s -o /tmp/am2.json -w "%{http_code}" -X POST http://localhost:3000/api/webhooks/agentmail \
  -H 'Content-Type: application/json' \
  -H 'X-AgentMail-Signature: sha256=deadbeef' \
  -d '{"organizationId":"x","providerEventId":"e1"}'
# expect 403

# Local mock header when secret unset → proceeds to Convex (may 500 if org invalid)
curl -s -X POST http://localhost:3000/api/webhooks/agentmail \
  -H 'Content-Type: application/json' \
  -H 'X-AgentMail-Mock: true' \
  -d '{"organizationId":"<orgId>","providerEventId":"fixture-1","from":"a@b.test","subject":"CIM","text":"hi"}'
```

### Twilio

```bash
# No auth token → 503 MOCK
curl -s -o /tmp/tw1.json -w "%{http_code}" -X POST http://localhost:3000/api/webhooks/twilio \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'From=%2B15555550100&To=%2B15555550199&Body=hi'
# expect 503

# Bad signature when token set → 403 (verifyTwilioRequest)
```

## Ambiguous outbound send

1. Approve + execute a POV approval (dry-run success).
2. As admin, call `outbound.markUnknownFixture` with the outbound action id (Convex dashboard or future UI).
3. Status becomes `unknown` with MOCK reason: send timed out after possible acceptance.
4. Operators must reconcile — do not auto-retry as a new send without ledger check.

## Ambiguous deal association

1. On `/pov`, check **Force ambiguous association**.
2. Start flow → inbox shows association review; run waits briefly for resolve.
3. Resolve on `/inbox` by picking a deal → workflow continues extraction/proposal.
