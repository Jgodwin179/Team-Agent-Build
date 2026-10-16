import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";
import { outboundActionStatusValidator } from "./schema";
import { reconcileMissedCore } from "./scheduleJobs";
import { purgeAllOrgsInternalCore } from "./retention";

/**
 * List outbound actions stuck in `unknown` (send timed out after possible accept).
 * Never auto-resends — operators reconcile against provider records first.
 */
export const listUnknownOutbound = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("outboundActions"),
      approvalId: v.id("approvals"),
      actionKey: v.string(),
      destination: v.string(),
      status: outboundActionStatusValidator,
      dryRun: v.boolean(),
      externalId: v.optional(v.string()),
      resultJson: v.optional(v.string()),
      updatedAt: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const limit = Math.min(args.limit ?? 50, 100);
    const rows = await ctx.db
      .query("outboundActions")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "unknown"),
      )
      .collect();
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((r) => ({
        _id: r._id,
        approvalId: r.approvalId,
        actionKey: r.actionKey,
        destination: r.destination,
        status: r.status,
        dryRun: r.dryRun,
        externalId: r.externalId,
        resultJson: r.resultJson,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
  },
});

/**
 * Resolve an unknown outbound after operator/provider check.
 * - `mark_failed`: provider confirms no delivery → failed (safe to propose again later)
 * - `mark_sent`: provider confirms delivery → sent (never resend)
 * - `mark_dry_run`: only when the action was dryRun — fold fixture unknowns back
 *
 * Does NOT resend. Live provider lookup is documented for operators; this mutation
 * only records the reconciliation outcome.
 */
export const resolveUnknownOutbound = mutation({
  args: {
    organizationId: v.id("organizations"),
    outboundActionId: v.id("outboundActions"),
    resolution: v.union(
      v.literal("mark_failed"),
      v.literal("mark_sent"),
      v.literal("mark_dry_run"),
    ),
    note: v.optional(v.string()),
    externalId: v.optional(v.string()),
  },
  returns: v.object({
    status: outboundActionStatusValidator,
    detail: v.string(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const row = await ctx.db.get("outboundActions", args.outboundActionId);
    if (!row || row.organizationId !== args.organizationId) {
      throw new Error("Outbound action not found");
    }
    if (row.status !== "unknown") {
      throw new Error(
        `Only unknown outbound can be reconciled (status=${row.status})`,
      );
    }
    if (args.resolution === "mark_dry_run" && !row.dryRun) {
      throw new Error("mark_dry_run only allowed for dry-run ledger rows");
    }

    const now = Date.now();
    const status =
      args.resolution === "mark_failed"
        ? ("failed" as const)
        : args.resolution === "mark_sent"
          ? ("sent" as const)
          : ("dry_run" as const);

    let prior: unknown = null;
    if (row.resultJson) {
      try {
        prior = JSON.parse(row.resultJson) as unknown;
      } catch {
        prior = row.resultJson;
      }
    }

    await ctx.db.patch("outboundActions", row._id, {
      status,
      externalId: args.externalId ?? row.externalId,
      resultJson: JSON.stringify({
        reconciledAt: now,
        resolution: args.resolution,
        note: args.note ?? null,
        prior,
      }),
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "reconcile.outbound_unknown",
      targetType: "outboundActions",
      targetId: row._id,
      metadata: JSON.stringify({
        resolution: args.resolution,
        status,
        note: args.note,
      }),
      createdAt: now,
    });

    return {
      status,
      detail: `Reconciled unknown → ${status} (no resend)`,
    };
  },
});

/**
 * Auto-fold dry-run unknowns back to dry_run (safe — never touches live sends).
 * Live unknowns are left for operators.
 */
export const foldDryRunUnknownsInternal = internalMutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    nowMs: v.number(),
  },
  returns: v.object({ folded: v.number(), skippedLive: v.number() }),
  handler: async (ctx, args) => {
    let folded = 0;
    let skippedLive = 0;
    const orgs = args.organizationId
      ? [await ctx.db.get("organizations", args.organizationId)].filter(
          (o): o is NonNullable<typeof o> => o != null,
        )
      : await ctx.db.query("organizations").collect();

    for (const org of orgs) {
      const rows = await ctx.db
        .query("outboundActions")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", org._id).eq("status", "unknown"),
        )
        .collect();
      for (const row of rows) {
        if (!row.dryRun) {
          skippedLive++;
          continue;
        }
        let prior: unknown = null;
        if (row.resultJson) {
          try {
            prior = JSON.parse(row.resultJson) as unknown;
          } catch {
            prior = row.resultJson;
          }
        }
        await ctx.db.patch("outboundActions", row._id, {
          status: "dry_run",
          resultJson: JSON.stringify({
            reconciledAt: args.nowMs,
            resolution: "auto_fold_dry_run",
            prior,
          }),
          updatedAt: args.nowMs,
        });
        folded++;
      }
    }
    return { folded, skippedLive };
  },
});

/**
 * Reconcile missed schedule transitions for all enabled schedules
 * in orgs that have schedulesEnabled.
 */
export const reconcileSchedulesInternal = internalMutation({
  args: { nowMs: v.number() },
  returns: v.object({
    schedulesChecked: v.number(),
    fired: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const orgs = await ctx.db.query("organizations").collect();
    let schedulesChecked = 0;
    let fired = 0;
    let skipped = 0;

    for (const org of orgs) {
      if (org.settings.schedulesEnabled !== true) continue;
      const schedules = await ctx.db
        .query("schedules")
        .withIndex("by_org_and_enabled", (q) =>
          q.eq("organizationId", org._id).eq("enabled", true),
        )
        .collect();
      for (const schedule of schedules) {
        schedulesChecked++;
        if (
          schedule.nextOccurrenceAt != null &&
          schedule.nextOccurrenceAt <= args.nowMs
        ) {
          const result = await reconcileMissedCore(
            ctx,
            schedule._id,
            args.nowMs,
          );
          fired += result.fired;
          skipped += result.skipped;
        }
      }
    }
    return { schedulesChecked, fired, skipped };
  },
});

/** Admin trigger for schedule reconcile (dev/ops). */
export const runScheduleReconcile = mutation({
  args: {
    organizationId: v.id("organizations"),
    nowMs: v.number(),
  },
  returns: v.object({
    schedulesChecked: v.number(),
    fired: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    if (organization.settings.schedulesEnabled !== true) {
      throw new Error(
        "Org schedulesEnabled is false — enable schedules before reconcile",
      );
    }
    const schedules = await ctx.db
      .query("schedules")
      .withIndex("by_org_and_enabled", (q) =>
        q.eq("organizationId", args.organizationId).eq("enabled", true),
      )
      .collect();
    let fired = 0;
    let skipped = 0;
    for (const schedule of schedules) {
      const result = await reconcileMissedCore(ctx, schedule._id, args.nowMs);
      fired += result.fired;
      skipped += result.skipped;
    }
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "reconcile.schedules_manual",
      targetType: "organizations",
      targetId: args.organizationId,
      metadata: JSON.stringify({
        schedulesChecked: schedules.length,
        fired,
        skipped,
      }),
      createdAt: Date.now(),
    });
    return {
      schedulesChecked: schedules.length,
      fired,
      skipped,
    };
  },
});

/** Admin trigger: fold dry-run unknowns for this org. */
export const foldDryRunUnknowns = mutation({
  args: { organizationId: v.id("organizations") },
  returns: v.object({ folded: v.number(), skippedLive: v.number() }),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "admin");
    const nowMs = Date.now();
    let folded = 0;
    let skippedLive = 0;
    const rows = await ctx.db
      .query("outboundActions")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "unknown"),
      )
      .collect();
    for (const row of rows) {
      if (!row.dryRun) {
        skippedLive++;
        continue;
      }
      let prior: unknown = null;
      if (row.resultJson) {
        try {
          prior = JSON.parse(row.resultJson) as unknown;
        } catch {
          prior = row.resultJson;
        }
      }
      await ctx.db.patch("outboundActions", row._id, {
        status: "dry_run",
        resultJson: JSON.stringify({
          reconciledAt: nowMs,
          resolution: "auto_fold_dry_run",
          prior,
        }),
        updatedAt: nowMs,
      });
      folded++;
    }
    return { folded, skippedLive };
  },
});

/** Cron wrappers — stamp Date.now() (cron args are static). */
export const cronReconcileSchedules = internalMutation({
  args: {},
  returns: v.object({
    schedulesChecked: v.number(),
    fired: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    const nowMs = Date.now();
    const orgs = await ctx.db.query("organizations").collect();
    let schedulesChecked = 0;
    let fired = 0;
    let skipped = 0;
    for (const org of orgs) {
      if (org.settings.schedulesEnabled !== true) continue;
      const schedules = await ctx.db
        .query("schedules")
        .withIndex("by_org_and_enabled", (q) =>
          q.eq("organizationId", org._id).eq("enabled", true),
        )
        .collect();
      for (const schedule of schedules) {
        schedulesChecked++;
        if (
          schedule.nextOccurrenceAt != null &&
          schedule.nextOccurrenceAt <= nowMs
        ) {
          const result = await reconcileMissedCore(ctx, schedule._id, nowMs);
          fired += result.fired;
          skipped += result.skipped;
        }
      }
    }
    return { schedulesChecked, fired, skipped };
  },
});

export const cronFoldDryRunUnknowns = internalMutation({
  args: {},
  returns: v.object({ folded: v.number(), skippedLive: v.number() }),
  handler: async (ctx) => {
    const nowMs = Date.now();
    let folded = 0;
    let skippedLive = 0;
    const orgs = await ctx.db.query("organizations").collect();
    for (const org of orgs) {
      const rows = await ctx.db
        .query("outboundActions")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", org._id).eq("status", "unknown"),
        )
        .collect();
      for (const row of rows) {
        if (!row.dryRun) {
          skippedLive++;
          continue;
        }
        let prior: unknown = null;
        if (row.resultJson) {
          try {
            prior = JSON.parse(row.resultJson) as unknown;
          } catch {
            prior = row.resultJson;
          }
        }
        await ctx.db.patch("outboundActions", row._id, {
          status: "dry_run",
          resultJson: JSON.stringify({
            reconciledAt: nowMs,
            resolution: "auto_fold_dry_run",
            prior,
          }),
          updatedAt: nowMs,
        });
        folded++;
      }
    }
    return { folded, skippedLive };
  },
});

export const cronRetentionPurge = internalMutation({
  args: {},
  returns: v.object({
    organizationsProcessed: v.number(),
    deletedTotal: v.number(),
  }),
  handler: async (ctx) => {
    return await purgeAllOrgsInternalCore(ctx, Date.now());
  },
});
