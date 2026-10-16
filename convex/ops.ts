import { v } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/permissions";
import { workflowManager } from "./workflows/manager";
import { inboundEventStatusValidator, runStatusValidator } from "./schema";

/**
 * Operator visibility: failed inbound events + failed runs.
 */
export const listFailedInboundEvents = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("inboundEvents"),
      provider: v.string(),
      providerEventId: v.string(),
      eventType: v.string(),
      status: inboundEventStatusValidator,
      attempts: v.number(),
      errorMessage: v.optional(v.string()),
      runId: v.optional(v.id("runs")),
      receivedAt: v.number(),
      dedupeKey: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const limit = Math.min(args.limit ?? 50, 100);
    const rows = await ctx.db
      .query("inboundEvents")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "failed"),
      )
      .collect();
    return rows
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, limit)
      .map((r) => ({
        _id: r._id,
        provider: r.provider,
        providerEventId: r.providerEventId,
        eventType: r.eventType,
        status: r.status,
        attempts: r.attempts,
        errorMessage: r.errorMessage,
        runId: r.runId,
        receivedAt: r.receivedAt,
        dedupeKey: r.dedupeKey,
      }));
  },
});

export const listFailedRuns = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("runs"),
      title: v.string(),
      status: runStatusValidator,
      errorMessage: v.optional(v.string()),
      specialistType: v.optional(v.string()),
      parentRunId: v.optional(v.id("runs")),
      workflowId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const limit = Math.min(args.limit ?? 50, 100);
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "failed"),
      )
      .collect();
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((r) => ({
        _id: r._id,
        title: r.title,
        status: r.status,
        errorMessage: r.errorMessage,
        specialistType: r.specialistType,
        parentRunId: r.parentRunId,
        workflowId: r.workflowId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
  },
});

export const opsSummary = query({
  args: { organizationId: v.id("organizations") },
  returns: v.object({
    failedInbound: v.number(),
    failedRuns: v.number(),
    unknownOutbound: v.number(),
    connectionsNeedingAttention: v.number(),
    schedulesEnabled: v.boolean(),
    outboundDryRun: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "viewer",
    );
    const failedInbound = (
      await ctx.db
        .query("inboundEvents")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "failed"),
        )
        .collect()
    ).length;
    const failedRuns = (
      await ctx.db
        .query("runs")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "failed"),
        )
        .collect()
    ).length;
    const unknownOutbound = (
      await ctx.db
        .query("outboundActions")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "unknown"),
        )
        .collect()
    ).length;
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const now = Date.now();
    const connectionsNeedingAttention = connections.filter(
      (c) =>
        c.health === "needs_reconnect" ||
        c.health === "expired" ||
        c.health === "error" ||
        c.status === "disconnected" ||
        (c.renewAfterAt != null && c.renewAfterAt <= now),
    ).length;

    return {
      failedInbound,
      failedRuns,
      unknownOutbound,
      connectionsNeedingAttention,
      schedulesEnabled: organization.settings.schedulesEnabled === true,
      outboundDryRun: organization.outboundDryRun !== false,
    };
  },
});

/**
 * Safe replay of a failed inbound event.
 * - Does not invent a new providerEventId (dedupe preserved).
 * - Creates a new run from the stored payload when no successful run exists,
 *   or resumes the failed run workflow when present.
 * - Never triggers live outbound; workflows remain dry-run/MOCK gated.
 */
export const replayFailedInbound = mutation({
  args: {
    organizationId: v.id("organizations"),
    inboundEventId: v.id("inboundEvents"),
  },
  returns: v.object({
    mode: v.union(v.literal("resumed"), v.literal("restarted"), v.literal("noop")),
    runId: v.optional(v.id("runs")),
    detail: v.string(),
  }),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    const event = await ctx.db.get("inboundEvents", args.inboundEventId);
    if (!event || event.organizationId !== args.organizationId) {
      throw new Error("Inbound event not found");
    }
    if (event.status !== "failed") {
      throw new Error(
        `Only failed events can be replayed (status=${event.status})`,
      );
    }

    const now = Date.now();

    // Prefer resume of existing failed run
    if (event.runId) {
      const run = await ctx.db.get("runs", event.runId);
      if (run && run.status === "failed" && run.workflowId) {
        await ctx.db.patch("runs", run._id, {
          status: "running",
          errorMessage: undefined,
          updatedAt: now,
        });
        await ctx.db.patch("inboundEvents", event._id, {
          status: "claimed",
          attempts: event.attempts + 1,
          errorMessage: undefined,
        });
        await workflowManager.restart(ctx, run.workflowId as WorkflowId);
        await ctx.db.insert("auditEvents", {
          organizationId: args.organizationId,
          actorAuthUserId: user.id,
          action: "ops.replay_inbound_resumed",
          targetType: "inboundEvents",
          targetId: event._id,
          metadata: JSON.stringify({ runId: run._id }),
          createdAt: now,
        });
        return {
          mode: "resumed" as const,
          runId: run._id,
          detail: "Resumed failed run workflow from journal",
        };
      }
    }

    // Restart: create a new run linked to the same inbound event (safe replay).
    const runId = await ctx.db.insert("runs", {
      organizationId: args.organizationId,
      inboundEventId: event._id,
      principalAuthUserId: user.id,
      title: `Replay: ${event.eventType}`,
      assignmentPrompt: `Safe replay of failed inbound ${event.providerEventId}. Payload: ${event.payloadJson.slice(0, 500)}`,
      specialistType: "coordinator",
      depth: 0,
      status: "queued",
      budgetTokens: organization.settings.defaultBudgetTokens ?? 50_000,
      usedTokens: 0,
      maxSteps: organization.settings.maxAgentSteps ?? 8,
      completedSteps: [],
      createdAt: now,
      updatedAt: now,
    });

    const workflowId = await workflowManager.start(
      ctx,
      internal.workflows.assignmentWorkflow.assignmentWorkflow,
      {
        runId,
        organizationId: args.organizationId,
        principalAuthUserId: user.id,
      },
    );

    await ctx.db.patch("runs", runId, {
      workflowId: String(workflowId),
      updatedAt: Date.now(),
    });
    await ctx.db.patch("inboundEvents", event._id, {
      status: "claimed",
      runId,
      attempts: event.attempts + 1,
      errorMessage: undefined,
    });

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "ops.replay_inbound_restarted",
      targetType: "inboundEvents",
      targetId: event._id,
      metadata: JSON.stringify({ runId }),
      createdAt: now,
    });

    return {
      mode: "restarted" as const,
      runId,
      detail: "Started new dry-run-safe assignment workflow for replay",
    };
  },
});

/** Fixture: mark an inbound event failed for ops UI demos. */
export const markInboundFailedFixture = mutation({
  args: {
    organizationId: v.id("organizations"),
    eventType: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.id("inboundEvents"),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const now = Date.now();
    const providerEventId = `ops-fixture-${now}`;
    const id = await ctx.db.insert("inboundEvents", {
      organizationId: args.organizationId,
      provider: "fixture",
      providerAccount: "ops",
      providerEventId,
      dedupeKey: `ops:failed:${providerEventId}`,
      eventType: args.eventType ?? "ops.fixture_failure",
      occurredAt: now,
      receivedAt: now,
      payloadJson: JSON.stringify({ source: "ops.markInboundFailedFixture" }),
      status: "failed",
      attempts: 1,
      errorMessage:
        args.errorMessage ?? "MOCK fixture — simulated processing failure",
    });
    await ctx.db.insert("inboxItems", {
      organizationId: args.organizationId,
      kind: "exception",
      status: "unread",
      title: "Failed inbound event",
      summary: args.errorMessage ?? "MOCK fixture failure",
      inboundEventId: id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "ops.fixture_failed_inbound",
      targetType: "inboundEvents",
      targetId: id,
      createdAt: now,
    });
    return id;
  },
});
