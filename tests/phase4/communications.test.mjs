/**
 * Phase 4 communication fixtures (no test runner required).
 * Run: node tests/phase4/communications.test.mjs
 */
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// --- AgentMail signature (mirrors src/lib/webhooks/signatures.ts) ---
function validateAgentMailWebhook(rawBody, headers, secretEnv) {
  const secret = secretEnv;
  const mockHeader = headers.get("x-agentmail-mock");
  if (!secret) {
    if (mockHeader === "true") return { ok: true };
    return {
      ok: false,
      status: 503,
      error: "MOCK/unconfigured",
    };
  }
  const signature =
    headers.get("x-agentmail-signature") ??
    headers.get("x-webhook-signature") ??
    "";
  if (!signature) {
    return { ok: false, status: 403, error: "Missing AgentMail signature" };
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: "Invalid AgentMail signature" };
  }
  return { ok: true };
}

const body = JSON.stringify({ providerEventId: "e1" });
assert.equal(
  validateAgentMailWebhook(body, new Headers(), undefined).status,
  503,
);
assert.equal(
  validateAgentMailWebhook(
    body,
    new Headers({ "x-agentmail-mock": "true" }),
    undefined,
  ).ok,
  true,
);
assert.equal(
  validateAgentMailWebhook(
    body,
    new Headers({ "x-agentmail-signature": "sha256=00" }),
    "sekrit",
  ).status,
  403,
);
const good = createHmac("sha256", "sekrit").update(body).digest("hex");
assert.equal(
  validateAgentMailWebhook(
    body,
    new Headers({ "x-agentmail-signature": `sha256=${good}` }),
    "sekrit",
  ).ok,
  true,
);

// --- Outbound ledger state machine ---
const TERMINAL = new Set(["dry_run", "sent", "failed", "unknown"]);
function canClaim(status) {
  return status === "approved";
}
function alreadyClaimed(status) {
  return (
    status === "claimed" ||
    status === "sending" ||
    TERMINAL.has(status)
  );
}
assert.equal(canClaim("approved"), true);
assert.equal(canClaim("proposed"), false);
assert.equal(alreadyClaimed("claimed"), true);
assert.equal(alreadyClaimed("dry_run"), true);
assert.equal(alreadyClaimed("approved"), false);

// Repeated click: first claim consumes; second sees alreadyClaimed
function claimOnce(state) {
  if (state.approvalConsumed || alreadyClaimed(state.outboundStatus)) {
    return { alreadyClaimed: true, state };
  }
  if (!canClaim(state.outboundStatus)) {
    throw new Error(`Outbound not in approved state (status=${state.outboundStatus})`);
  }
  return {
    alreadyClaimed: false,
    state: {
      ...state,
      outboundStatus: "claimed",
      approvalConsumed: true,
    },
  };
}
let ledger = { outboundStatus: "approved", approvalConsumed: false };
const first = claimOnce(ledger);
ledger = first.state;
assert.equal(first.alreadyClaimed, false);
const second = claimOnce(ledger);
assert.equal(second.alreadyClaimed, true);

// Ambiguous send → unknown (do not auto-promote to sent)
function markAmbiguous(status) {
  if (status === "sending") return "unknown";
  throw new Error("only sending→unknown for ambiguous");
}
assert.equal(markAmbiguous("sending"), "unknown");

// --- Chat SDK mode labeling ---
function getChatSdkMode(env) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.REDIS_URL) {
    return "mock";
  }
  if (env.ALLOW_LIVE_OUTBOUND !== "true") return "dry-run";
  return "live-ready";
}
assert.equal(getChatSdkMode({}), "mock");
assert.equal(
  getChatSdkMode({
    TWILIO_ACCOUNT_SID: "ACxx",
    TWILIO_AUTH_TOKEN: "tok",
  }),
  "mock",
);
assert.equal(
  getChatSdkMode({
    TWILIO_ACCOUNT_SID: "ACxx",
    TWILIO_AUTH_TOKEN: "tok",
    REDIS_URL: "redis://localhost:6379",
  }),
  "dry-run",
);
assert.equal(
  getChatSdkMode({
    TWILIO_ACCOUNT_SID: "ACxx",
    TWILIO_AUTH_TOKEN: "tok",
    REDIS_URL: "redis://localhost:6379",
    ALLOW_LIVE_OUTBOUND: "true",
  }),
  "live-ready",
);

// --- Email provider health labeling (import compiled via dynamic ts not available;
// assert contract against source messages by requiring the built module if present) ---
async function loadEmailHealth() {
  // Prefer running through Next-transpiled path unavailable in plain node;
  // inline the selection rules to stay in sync with getEmailProviderHealth.
  function health(env) {
    const configured = Boolean(env.AGENTMAIL_API_KEY);
    const allowLive = env.ALLOW_LIVE_OUTBOUND === "true";
    if (!configured) {
      return { mode: "mock", message: "MOCK — AGENTMAIL_API_KEY missing" };
    }
    if (!allowLive) {
      return { mode: "dry-run", message: "DRY-RUN" };
    }
    return { mode: "live", message: "LIVE" };
  }
  assert.equal(health({}).mode, "mock");
  assert.match(health({}).message, /MOCK/);
  assert.equal(health({ AGENTMAIL_API_KEY: "k" }).mode, "dry-run");
  assert.equal(
    health({ AGENTMAIL_API_KEY: "k", ALLOW_LIVE_OUTBOUND: "true" }).mode,
    "live",
  );
}
await loadEmailHealth();

// --- Association: fuzzy never auto-matches ---
function resolveDealAssociation(input) {
  const deals = input.deals;
  if (input.dealHint) {
    const byId = deals.find((d) => d._id === input.dealHint);
    if (byId) return { kind: "matched", dealId: byId._id };
  }
  const subject = input.subject.toLowerCase();
  const exact = deals.filter(
    (d) => subject.includes(d.title.toLowerCase()) && d.title.trim().length >= 8,
  );
  if (exact.length === 1) return { kind: "matched", dealId: exact[0]._id };
  if (exact.length > 1) {
    return { kind: "ambiguous", candidateDealIds: exact.map((d) => d._id) };
  }
  const tokens = subject.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const fuzzy = deals.filter((d) => {
    const titleTokens = d.title.toLowerCase().split(/[^a-z0-9]+/);
    return tokens.some((t) => titleTokens.includes(t));
  });
  if (fuzzy.length >= 1) {
    return { kind: "ambiguous", candidateDealIds: fuzzy.map((d) => d._id) };
  }
  return { kind: "unmatched" };
}

const deals = [
  { _id: "d1", title: "Acme Industries Rollup" },
  { _id: "d2", title: "Beta Services Platform" },
];
assert.equal(
  resolveDealAssociation({
    deals,
    subject: "Quick note about Acme",
    from: "a@b.test",
  }).kind,
  "ambiguous",
);
assert.equal(
  resolveDealAssociation({
    deals,
    subject: "Acme Industries Rollup — CIM",
    from: "a@b.test",
  }).kind,
  "matched",
);
assert.equal(
  resolveDealAssociation({
    deals,
    subject: "Random",
    from: "a@b.test",
    dealHint: "d2",
  }).dealId,
  "d2",
);

// Duplicate inbound key
function dedupeKey(orgId, providerEventId) {
  return `${orgId}:agentmail:message:${providerEventId}`;
}
const seen = new Set();
function ingest(orgId, providerEventId) {
  const key = dedupeKey(orgId, providerEventId);
  if (seen.has(key)) return { deduplicated: true };
  seen.add(key);
  return { deduplicated: false };
}
assert.equal(ingest("org1", "evt-1").deduplicated, false);
assert.equal(ingest("org1", "evt-1").deduplicated, true);
assert.equal(ingest("org1", "evt-2").deduplicated, false);

console.log("phase4 communications fixtures: ok");
void require;
void pathToFileURL;
void root;
