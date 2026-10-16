/**
 * Wall-clock scheduling helpers (no luxon dependency).
 *
 * DST policy (documented):
 * - Recurrence is expressed as **local wall-clock** in an IANA timezone
 *   (default America/New_York). We never treat "9:00 AM daily" as a fixed
 *   UTC offset.
 * - Spring forward: if the wall time does not exist (e.g. 02:30 on the
 *   transition day), we advance to the next valid minute after the gap.
 * - Fall back: if the wall time occurs twice, we use the **earlier** UTC
 *   instant. Occurrence keys are based on local date+time+timezone so a
 *   logical day fires once.
 */

export const DEFAULT_SCHEDULE_TIMEZONE = "America/New_York";

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatLocalDate(parts: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function getLocalParts(utcMs: number, timeZone: string): LocalParts {
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
  ) as Record<string, string>;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  let hour = Number(map.hour);
  // Some environments emit "24" for midnight
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday ?? "Sun"] ?? 0,
  };
}

/** Offset of `timeZone` at `utcMs`: local = utc + offset. */
export function getTimeZoneOffsetMs(timeZone: string, utcMs: number): number {
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

/**
 * Convert a local wall-clock civil time in `timeZone` to UTC ms.
 * Handles DST gaps (spring) and overlaps (fall) per policy above.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = utcGuess - offset1;
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset1) {
    // Prefer earlier instant on overlap; on gap, re-resolve with offset2.
    utc = utcGuess - offset2;
  }

  // If still not representing the requested wall time (spring gap), nudge forward.
  const resolved = getLocalParts(utc, timeZone);
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    // Advance minute-by-minute up to 3 hours through the gap.
    for (let i = 1; i <= 180; i++) {
      const candidate = zonedWallTimeToUtcSimple(
        year,
        month,
        day,
        hour,
        minute + i,
        timeZone,
      );
      const parts = getLocalParts(candidate, timeZone);
      if (
        parts.year === year &&
        parts.month === month &&
        parts.day === day &&
        (parts.hour > hour ||
          (parts.hour === hour && parts.minute >= minute) ||
          parts.hour < hour) // rolled
      ) {
        // First valid local minute at/after intended wall time on that civil day,
        // or next day if rolled — for schedule preview we return candidate.
        return candidate;
      }
    }
  }
  return utc;
}

function zonedWallTimeToUtcSimple(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  // Normalize minute overflow
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + 1;
  const d = base.getUTCDate();
  const h = base.getUTCHours();
  const min = base.getUTCMinutes();
  const utcGuess = Date.UTC(y, m - 1, d, h, min, 0);
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = utcGuess - offset;
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset) utc = utcGuess - offset2;
  return utc;
}

export type RecurrenceConfig = {
  recurrence: "once" | "daily" | "weekly";
  timezone: string;
  localHour: number;
  localMinute: number;
  daysOfWeek?: number[];
  startAtUtc?: number;
  endAtUtc?: number;
};

/**
 * Next occurrence strictly after `afterUtc` (exclusive), or null if none.
 */
export function computeNextOccurrence(
  config: RecurrenceConfig,
  afterUtc: number,
): { at: number; localDate: string; localHour: number; localMinute: number } | null {
  if (config.recurrence === "once") {
    const at = config.startAtUtc;
    if (at == null || at <= afterUtc) return null;
    if (config.endAtUtc != null && at > config.endAtUtc) return null;
    const local = getLocalParts(at, config.timezone);
    return {
      at,
      localDate: formatLocalDate(local),
      localHour: local.hour,
      localMinute: local.minute,
    };
  }

  // Search up to ~400 days ahead
  let cursor = afterUtc + 1;
  for (let i = 0; i < 400; i++) {
    const local = getLocalParts(cursor, config.timezone);
    // Candidate: today's wall clock if still in future, else tomorrow onwards
    const year = local.year;
    const month = local.month;
    const day = local.day;

    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
      const civil = addLocalDays(year, month, day, dayOffset);
      if (
        config.recurrence === "weekly" &&
        config.daysOfWeek &&
        config.daysOfWeek.length > 0
      ) {
        const wd = weekdayForCivil(
          civil.year,
          civil.month,
          civil.day,
          config.timezone,
        );
        if (!config.daysOfWeek.includes(wd)) continue;
      }
      const at = zonedWallTimeToUtc(
        civil.year,
        civil.month,
        civil.day,
        config.localHour,
        config.localMinute,
        config.timezone,
      );
      if (at <= afterUtc) continue;
      if (config.endAtUtc != null && at > config.endAtUtc) return null;
      if (config.startAtUtc != null && at < config.startAtUtc) continue;
      return {
        at,
        localDate: formatLocalDate(civil),
        localHour: config.localHour,
        localMinute: config.localMinute,
      };
    }

    // Jump cursor forward ~1 day
    cursor += 24 * 60 * 60 * 1000;
  }
  return null;
}

function addLocalDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function weekdayForCivil(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  // Noon UTC proxy then read weekday in zone — robust enough for civil dates.
  const utc = zonedWallTimeToUtc(year, month, day, 12, 0, timeZone);
  return getLocalParts(utc, timeZone).weekday;
}

export function buildOccurrenceKey(input: {
  scheduleId: string;
  localDate: string;
  localHour: number;
  localMinute: number;
  timezone: string;
}): string {
  return [
    input.scheduleId,
    input.localDate,
    `${pad2(input.localHour)}:${pad2(input.localMinute)}`,
    input.timezone,
  ].join("|");
}
