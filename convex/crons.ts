import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Launch-readiness reconciliation + retention crons.
 *
 * Safe by default:
 * - Outbound reconcile only folds dry-run unknowns (never resends live).
 * - Schedule reconcile only runs for orgs with schedulesEnabled=true.
 * - Retention purges only audit/usage/succeeded-inbound (never ledger/docs/deals).
 *
 * Do not enable production automation / live provider smoke without
 * explicit user authorization — keep ALLOW_LIVE_OUTBOUND unset.
 */
const crons = cronJobs();

crons.interval(
  "reconcile-schedules-missed",
  { minutes: 15 },
  internal.reconcile.cronReconcileSchedules,
  {},
);

crons.interval(
  "reconcile-fold-dry-run-unknowns",
  { hours: 1 },
  internal.reconcile.cronFoldDryRunUnknowns,
  {},
);

crons.daily(
  "retention-purge-safe-tables",
  { hourUTC: 7, minuteUTC: 30 },
  internal.reconcile.cronRetentionPurge,
  {},
);

export default crons;
