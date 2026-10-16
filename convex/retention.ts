import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";

const DEFAULT_RETENTION_DAYS = 90;
const MAX_DELETE_BATCH = 200;

function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Retention preview — never deletes. Safe for viewers.
 * Only succeeded inbound events, audit rows, and usage rows are candidates.
 * Runs, approvals, outbound ledger, documents, and deals are never auto-purged.
 */
export const previewPurge = query({
  args: {
    organizationId: v.id("organizations"),
    nowMs: v.number(),
  },
  returns: v.object({
    retentionDaysAudit: v.number(),
    retentionDaysUsage: v.number(),
    retentionDaysInboundSucceeded: v.number(),
    candidateAudit: v.number(),
    candidateUsage: v.number(),
    candidateInboundSucceeded: v.number(),
    neverAutoDeleted: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const { organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "viewer",
    );
    const retentionDaysAudit =
      organization.settings.retentionDaysAudit ?? DEFAULT_RETENTION_DAYS;
    const retentionDaysUsage =
      organization.settings.retentionDaysUsage ?? DEFAULT_RETENTION_DAYS;
    const retentionDaysInboundSucceeded =
      organization.settings.retentionDaysInboundSucceeded ??
      DEFAULT_RETENTION_DAYS;

    const auditCutoff = args.nowMs - daysToMs(retentionDaysAudit);
    const usageCutoff = args.nowMs - daysToMs(retentionDaysUsage);
    const inboundCutoff = args.nowMs - daysToMs(retentionDaysInboundSucceeded);

    const audit = await ctx.db
      .query("auditEvents")
      .withIndex("by_org_and_created", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const candidateAudit = audit.filter((r) => r.createdAt < auditCutoff).length;

    const usage = await ctx.db
      .query("usageRecords")
      .withIndex("by_org_and_created", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const candidateUsage = usage.filter((r) => r.createdAt < usageCutoff).length;

    const inbound = await ctx.db
      .query("inboundEvents")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "succeeded"),
      )
      .collect();
    const candidateInboundSucceeded = inbound.filter(
      (r) => r.receivedAt < inboundCutoff,
    ).length;

    return {
      retentionDaysAudit,
      retentionDaysUsage,
      retentionDaysInboundSucceeded,
      candidateAudit,
      candidateUsage,
      candidateInboundSucceeded,
      neverAutoDeleted: [
        "runs",
        "approvals",
        "outboundActions",
        "documents",
        "documentChunks",
        "deals",
        "connections",
        "schedules",
        "failed inboundEvents",
      ],
    };
  },
});

export const updateRetentionSettings = mutation({
  args: {
    organizationId: v.id("organizations"),
    retentionDaysAudit: v.optional(v.number()),
    retentionDaysUsage: v.optional(v.number()),
    retentionDaysInboundSucceeded: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    const clamp = (n: number | undefined) => {
      if (n === undefined) return undefined;
      if (!Number.isFinite(n) || n < 7) {
        throw new Error("Retention days must be at least 7");
      }
      if (n > 3650) throw new Error("Retention days must be <= 3650");
      return Math.floor(n);
    };
    const next = {
      ...organization.settings,
      retentionDaysAudit:
        clamp(args.retentionDaysAudit) ??
        organization.settings.retentionDaysAudit,
      retentionDaysUsage:
        clamp(args.retentionDaysUsage) ??
        organization.settings.retentionDaysUsage,
      retentionDaysInboundSucceeded:
        clamp(args.retentionDaysInboundSucceeded) ??
        organization.settings.retentionDaysInboundSucceeded,
    };
    const now = Date.now();
    await ctx.db.patch("organizations", args.organizationId, {
      settings: next,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "retention.settings_updated",
      targetType: "organizations",
      targetId: args.organizationId,
      metadata: JSON.stringify(next),
      createdAt: now,
    });
    return null;
  },
});

/**
 * Execute a bounded purge batch. Admin-only.
 * Defaults to dryRun=true — set execute=true explicitly to delete.
 */
export const runPurgeBatch = mutation({
  args: {
    organizationId: v.id("organizations"),
    nowMs: v.number(),
    execute: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    deletedAudit: v.number(),
    deletedUsage: v.number(),
    deletedInbound: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    const execute = args.execute === true;
    const limit = Math.min(args.limit ?? MAX_DELETE_BATCH, MAX_DELETE_BATCH);
    const retentionDaysAudit =
      organization.settings.retentionDaysAudit ?? DEFAULT_RETENTION_DAYS;
    const retentionDaysUsage =
      organization.settings.retentionDaysUsage ?? DEFAULT_RETENTION_DAYS;
    const retentionDaysInboundSucceeded =
      organization.settings.retentionDaysInboundSucceeded ??
      DEFAULT_RETENTION_DAYS;

    const auditCutoff = args.nowMs - daysToMs(retentionDaysAudit);
    const usageCutoff = args.nowMs - daysToMs(retentionDaysUsage);
    const inboundCutoff = args.nowMs - daysToMs(retentionDaysInboundSucceeded);

    let deletedAudit = 0;
    let deletedUsage = 0;
    let deletedInbound = 0;

    const audit = await ctx.db
      .query("auditEvents")
      .withIndex("by_org_and_created", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    for (const row of audit) {
      if (deletedAudit >= limit) break;
      if (row.createdAt >= auditCutoff) continue;
      if (execute) await ctx.db.delete("auditEvents", row._id);
      deletedAudit++;
    }

    const usage = await ctx.db
      .query("usageRecords")
      .withIndex("by_org_and_created", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    for (const row of usage) {
      if (deletedUsage >= limit) break;
      if (row.createdAt >= usageCutoff) continue;
      if (execute) await ctx.db.delete("usageRecords", row._id);
      deletedUsage++;
    }

    const inbound = await ctx.db
      .query("inboundEvents")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "succeeded"),
      )
      .collect();
    for (const row of inbound) {
      if (deletedInbound >= limit) break;
      if (row.receivedAt >= inboundCutoff) continue;
      if (execute) await ctx.db.delete("inboundEvents", row._id);
      deletedInbound++;
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: execute ? "retention.purge_executed" : "retention.purge_previewed",
      targetType: "organizations",
      targetId: args.organizationId,
      metadata: JSON.stringify({
        deletedAudit,
        deletedUsage,
        deletedInbound,
        execute,
      }),
      createdAt: Date.now(),
    });

    return {
      dryRun: !execute,
      deletedAudit,
      deletedUsage,
      deletedInbound,
    };
  },
});

/** Shared purge core for cron + internalMutation. Safe tables only. */
export async function purgeAllOrgsInternalCore(
  ctx: MutationCtx,
  nowMs: number,
): Promise<{ organizationsProcessed: number; deletedTotal: number }> {
  const orgs = await ctx.db.query("organizations").collect();
  let organizationsProcessed = 0;
  let deletedTotal = 0;
  for (const organization of orgs) {
    if (organization.status !== "active") continue;
    organizationsProcessed++;
    const retentionDaysAudit =
      organization.settings.retentionDaysAudit ?? DEFAULT_RETENTION_DAYS;
    const retentionDaysUsage =
      organization.settings.retentionDaysUsage ?? DEFAULT_RETENTION_DAYS;
    const retentionDaysInboundSucceeded =
      organization.settings.retentionDaysInboundSucceeded ??
      DEFAULT_RETENTION_DAYS;
    const auditCutoff = nowMs - daysToMs(retentionDaysAudit);
    const usageCutoff = nowMs - daysToMs(retentionDaysUsage);
    const inboundCutoff = nowMs - daysToMs(retentionDaysInboundSucceeded);

    let batch = 0;
    const audit = await ctx.db
      .query("auditEvents")
      .withIndex("by_org_and_created", (q) =>
        q.eq("organizationId", organization._id),
      )
      .collect();
    for (const row of audit) {
      if (batch >= MAX_DELETE_BATCH) break;
      if (row.createdAt >= auditCutoff) continue;
      await ctx.db.delete("auditEvents", row._id);
      batch++;
      deletedTotal++;
    }

    const usage = await ctx.db
      .query("usageRecords")
      .withIndex("by_org_and_created", (q) =>
        q.eq("organizationId", organization._id),
      )
      .collect();
    for (const row of usage) {
      if (batch >= MAX_DELETE_BATCH) break;
      if (row.createdAt >= usageCutoff) continue;
      await ctx.db.delete("usageRecords", row._id);
      batch++;
      deletedTotal++;
    }

    const inbound = await ctx.db
      .query("inboundEvents")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", organization._id).eq("status", "succeeded"),
      )
      .collect();
    for (const row of inbound) {
      if (batch >= MAX_DELETE_BATCH) break;
      if (row.receivedAt >= inboundCutoff) continue;
      await ctx.db.delete("inboundEvents", row._id);
      batch++;
      deletedTotal++;
    }
  }
  return { organizationsProcessed, deletedTotal };
}

/** Cron entry: purge for all orgs (bounded). Safe tables only. */
export const purgeAllOrgsInternal = internalMutation({
  args: { nowMs: v.number() },
  returns: v.object({
    organizationsProcessed: v.number(),
    deletedTotal: v.number(),
  }),
  handler: async (ctx, args) => {
    return await purgeAllOrgsInternalCore(ctx, args.nowMs);
  },
});
