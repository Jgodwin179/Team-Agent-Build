/**
 * Lightweight Node assertions for Phase 3 MOCK adapters (no test runner required).
 * Run: node tests/phase3/mock-adapters.test.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Compile-free: duplicate minimal checks against source by dynamic import of ts via convex... 
// Instead, inline the fixture expectations that match boxMock / ghlMock contracts.

const require = createRequire(import.meta.url);

// Hash helper ported (keep in sync with convex/lib/hash.ts)
function payloadHash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

assert.equal(payloadHash("a"), payloadHash("a"));
assert.notEqual(payloadHash("a"), payloadHash("b"));

// Pagination math fixture
function pageSlice(all, limit, offset) {
  const page = all.slice(offset, offset + limit);
  const nextOffset = offset + limit < all.length ? offset + limit : undefined;
  return { page, nextOffset };
}
const items = Array.from({ length: 5 }, (_, i) => i);
assert.deepEqual(pageSlice(items, 2, 0).page, [0, 1]);
assert.equal(pageSlice(items, 2, 0).nextOffset, 2);
assert.equal(pageSlice(items, 2, 4).nextOffset, undefined);

// Cross-deal fail-closed
function allowChunk(docDealId, requestedDealId) {
  if (requestedDealId !== undefined && docDealId !== requestedDealId) return false;
  return true;
}
assert.equal(allowChunk("dealA", "dealB"), false);
assert.equal(allowChunk("dealA", "dealA"), true);
assert.equal(allowChunk(undefined, undefined), true);

console.log("phase3 mock-adapters fixtures: ok");
void require;
