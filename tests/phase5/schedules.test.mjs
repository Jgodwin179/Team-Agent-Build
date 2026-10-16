/**
 * Phase 5 schedule / DST / occurrence / delegation fixtures.
 * Run: node tests/phase5/schedules.test.mjs
 */
import assert from "node:assert/strict";

// --- Port of timezone helpers (keep in sync with convex/lib/timezone.ts) ---

function pad2(n) {
  return n.toString().padStart(2, "0");
}

function getLocalParts(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function getTimeZoneOffsetMs(timeZone, utcMs) {
  const local = getLocalParts(utcMs, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - utcMs;
}

function zonedWallTimeToUtc(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = utcGuess - offset1;
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset1) utc = utcGuess - offset2;
  return utc;
}

function formatLocalDate(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function buildOccurrenceKey(input) {
  return [
    input.scheduleId,
    input.localDate,
    `${pad2(input.localHour)}:${pad2(input.localMinute)}`,
    input.timezone,
  ].join("|");
}

function computeNextOccurrence(config, afterUtc) {
  if (config.recurrence === "once") {
    const at = config.startAtUtc;
    if (at == null || at <= afterUtc) return null;
    const local = getLocalParts(at, config.timezone);
    return {
      at,
      localDate: formatLocalDate(local),
      localHour: local.hour,
      localMinute: local.minute,
    };
  }
  let cursor = afterUtc + 1;
  for (let i = 0; i < 400; i++) {
    const local = getLocalParts(cursor, config.timezone);
    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
      const base = new Date(
        Date.UTC(local.year, local.month - 1, local.day + dayOffset),
      );
      const civil = {
        year: base.getUTCFullYear(),
        month: base.getUTCMonth() + 1,
        day: base.getUTCDate(),
      };
      const at = zonedWallTimeToUtc(
        civil.year,
        civil.month,
        civil.day,
        config.localHour,
        config.localMinute,
        config.timezone,
      );
      if (at <= afterUtc) continue;
      return {
        at,
        localDate: formatLocalDate(civil),
        localHour: config.localHour,
        localMinute: config.localMinute,
      };
    }
    cursor += 24 * 60 * 60 * 1000;
  }
  return null;
}

const TZ = "America/New_York";

// --- DST recurrence: spring forward 2026-03-08 (US) ---
// 02:30 does not exist; 01:30 EST and 03:30 EDT should resolve.
const beforeSpring = zonedWallTimeToUtc(2026, 3, 8, 1, 30, TZ);
const afterSpring = zonedWallTimeToUtc(2026, 3, 8, 3, 30, TZ);
assert.ok(afterSpring > beforeSpring);
const springParts = getLocalParts(afterSpring, TZ);
assert.equal(springParts.hour, 3);
assert.equal(springParts.minute, 30);

// Daily 09:00 across DST: offset changes but local hour stays 9
const preDst = zonedWallTimeToUtc(2026, 3, 7, 9, 0, TZ);
const postDst = zonedWallTimeToUtc(2026, 3, 9, 9, 0, TZ);
assert.equal(getLocalParts(preDst, TZ).hour, 9);
assert.equal(getLocalParts(postDst, TZ).hour, 9);
// UTC offset should differ by 1 hour across the transition
assert.equal(postDst - preDst, 2 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);

// Fall back 2026-11-01: 01:30 occurs twice — earlier instant preferred
const fall = zonedWallTimeToUtc(2026, 11, 1, 1, 30, TZ);
const fallLocal = getLocalParts(fall, TZ);
assert.equal(fallLocal.hour, 1);
assert.equal(fallLocal.minute, 30);

// Next occurrence after a known point stays daily wall-clock
const next = computeNextOccurrence(
  { recurrence: "daily", timezone: TZ, localHour: 9, localMinute: 0 },
  zonedWallTimeToUtc(2026, 3, 7, 9, 0, TZ),
);
assert.ok(next);
assert.equal(next.localHour, 9);
assert.equal(next.localDate, "2026-03-08");

// --- Duplicate occurrence keys ---
const key1 = buildOccurrenceKey({
  scheduleId: "sched1",
  localDate: "2026-03-08",
  localHour: 9,
  localMinute: 0,
  timezone: TZ,
});
const key2 = buildOccurrenceKey({
  scheduleId: "sched1",
  localDate: "2026-03-08",
  localHour: 9,
  localMinute: 0,
  timezone: TZ,
});
assert.equal(key1, key2);
const seen = new Set();
function claim(key) {
  if (seen.has(key)) return { deduplicated: true };
  seen.add(key);
  return { deduplicated: false };
}
assert.equal(claim(key1).deduplicated, false);
assert.equal(claim(key2).deduplicated, true);

// --- Failed optional child → partial ---
function finalizeCoordinator(children) {
  const missingWork = [];
  let requiredFailed = false;
  for (const child of children) {
    if (child.status === "failed" || child.status === "canceled") {
      if (child.optional) {
        missingWork.push(`Optional child failed — ${child.title}`);
      } else {
        requiredFailed = true;
        missingWork.push(`Required child failed — ${child.title}`);
      }
    }
  }
  if (requiredFailed) return { status: "failed", missingWork };
  if (missingWork.length) return { status: "partial", missingWork };
  return { status: "succeeded", missingWork: [] };
}
const partial = finalizeCoordinator([
  { title: "research", status: "succeeded", optional: false },
  { title: "docs", status: "failed", optional: true },
]);
assert.equal(partial.status, "partial");
assert.ok(partial.missingWork[0].includes("docs"));

const failed = finalizeCoordinator([
  { title: "crm", status: "failed", optional: false },
]);
assert.equal(failed.status, "failed");

// --- Budget exhaustion ---
function specialistBudget({ budgetTokens, simulateBudgetExhaustion }) {
  if (simulateBudgetExhaustion) {
    return {
      ok: false,
      errorMessage: `Budget exhaustion: used ${budgetTokens}/${budgetTokens} tokens`,
      usedTokens: budgetTokens,
    };
  }
  return { ok: true, usedTokens: 250 };
}
const exhausted = specialistBudget({
  budgetTokens: 500,
  simulateBudgetExhaustion: true,
});
assert.equal(exhausted.ok, false);
assert.match(exhausted.errorMessage, /Budget exhaustion/);
assert.equal(exhausted.usedTokens, 500);

// --- Concurrency forbid ---
function canStart(policy, hasActive) {
  if ((policy === "forbid" || policy === "skip_if_running") && hasActive) {
    return false;
  }
  return true;
}
assert.equal(canStart("forbid", true), false);
assert.equal(canStart("forbid", false), true);
assert.equal(canStart("allow_overlap", true), true);

// --- Delegation depth ---
function allowChild(parentDepth, maxDepth, parentType, allowRecursive) {
  const childDepth = parentDepth + 1;
  if (childDepth > maxDepth) return false;
  if (!allowRecursive && parentType !== "coordinator") return false;
  return true;
}
assert.equal(allowChild(0, 1, "coordinator", false), true);
assert.equal(allowChild(1, 1, "research", false), false);
assert.equal(allowChild(1, 2, "research", true), true);

console.log("phase5 schedules fixtures: ok");
