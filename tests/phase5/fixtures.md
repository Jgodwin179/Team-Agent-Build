# Phase 5 fixtures

## DST recurrence

- Wall-clock times are in the schedule timezone (default `America/New_York`).
- Spring forward: non-existent local times advance to the next valid minute.
- Fall back: overlapping local times use the earlier UTC instant.
- Occurrence keys: `scheduleId|YYYY-MM-DD|HH:mm|timezone` (one logical job per wall-clock slot).
- Run: `node tests/phase5/schedules.test.mjs`

## Duplicate occurrences

1. Create a schedule; enable org + schedule (or use **Run now** twice with the same scheduled key via fireOccurrence).
2. Second claim with the same `occurrenceKey` returns `deduplicated` and reuses the run id.
3. Manual runs use `scheduleId|manual|{timestamp}` keys so they do not collide with scheduled keys.

## Failed optional child

1. Open `/schedules` → **Run coordinator (optional child fails)**.
2. Open the coordinator run → child tree shows research succeeded, documents failed (optional).
3. Coordinator `resultSummary` includes `MISSING:` lines; `missingWorkJson` populated; status `succeeded` (partial).

## Budget exhaustion

1. `/schedules` → **Run budget exhaustion child**.
2. Child fails with `Budget exhaustion: used N/N tokens`.
3. Coordinator finalizes as failed (required child).

## Cancellation propagation

1. Start a coordinator with children.
2. While running, **Request cancel** on the parent.
3. Children receive `cancel_requested` / `canceled` via tree walk in `runs.requestCancel`.

## Schedules disabled by default

- Org `settings.schedulesEnabled` defaults false.
- New schedules are created `enabled: false`.
- Enabling a schedule requires org schedulesEnabled=true (admin toggle on Schedules page).
