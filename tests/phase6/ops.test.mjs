/**
 * Phase 6 unit-ish fixtures (no live providers).
 * Retention day math + outbound resolve policy helpers mirrored in comments.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function candidatesOlderThan(rows, cutoff, field) {
  return rows.filter((r) => r[field] < cutoff);
}

describe("phase6 retention math", () => {
  it("selects only rows older than retention window", () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const days = 90;
    const cutoff = now - daysToMs(days);
    const rows = [
      { createdAt: now - daysToMs(91) },
      { createdAt: now - daysToMs(89) },
      { createdAt: now },
    ];
    const c = candidatesOlderThan(rows, cutoff, "createdAt");
    assert.equal(c.length, 1);
  });

  it("never treats failed inbound as purge candidates", () => {
    const purgeableStatuses = new Set(["succeeded"]);
    const inbound = [
      { status: "failed", receivedAt: 0 },
      { status: "succeeded", receivedAt: 0 },
    ];
    const candidates = inbound.filter((r) => purgeableStatuses.has(r.status));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].status, "succeeded");
  });
});

describe("phase6 unknown outbound policy", () => {
  it("allows mark_dry_run only when dryRun=true", () => {
    function canMarkDryRun(row) {
      return row.dryRun === true;
    }
    assert.equal(canMarkDryRun({ dryRun: true }), true);
    assert.equal(canMarkDryRun({ dryRun: false }), false);
  });

  it("resolution map never includes resend", () => {
    const resolutions = ["mark_failed", "mark_sent", "mark_dry_run"];
    assert.equal(resolutions.includes("resend"), false);
  });
});

describe("phase6 replay safety", () => {
  it("requires failed status for replay", () => {
    function canReplay(status) {
      return status === "failed";
    }
    assert.equal(canReplay("failed"), true);
    assert.equal(canReplay("succeeded"), false);
    assert.equal(canReplay("claimed"), false);
  });
});
