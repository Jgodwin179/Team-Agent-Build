import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { WorkflowId } from "@convex-dev/workflow";
import { workflowManager } from "./workflows/manager";
import {
  buildOccurrenceKey,
  computeNextOccurrence,
  DEFAULT_SCHEDULE_TIMEZONE,
} from "./lib/timezone";
import { orgDelegationLimits } from "./lib/delegationLimits";

async function armNextOccurrence(
  ctx: MutationCtx,
  scheduleId: Id<"schedules">,
  afterUtc: number,
): Promise<{
  at: number;
  occurrenceKey: string;
  jobId: Id<"_scheduled_functions">;
} | null> {
  const schedule = await ctx.db.get("schedules", scheduleId);
  if (!schedule || !schedule.enabled) {
    if (schedule) {
      await ctx.db.patch("schedules", scheduleId, {
        nextOccurrenceAt: undefined,
        nextOccurrenceKey: undefined,
        schedulerJobId: undefined,
        updatedAt: Date.now(),
      });
    }
    return null;
  }

  const organization = await ctx.db.get("organizations", schedule.organizationId);
  if (!organization || !orgDelegationLimits(organization).schedulesEnabled) {
    await ctx.db.patch("schedules", scheduleId, {
      nextOccurrenceAt: undefined,
      nextOccurrenceKey: undefined,
      schedulerJobId: undefined,
      updatedAt: Date.now(),
    });
    return null;
  }

  if (schedule.schedulerJobId) {
    try {
      await ctx.scheduler.cancel(schedule.schedulerJobId);
    } catch {
      // already fired or canceled
    }
  }

  const next = computeNextOccurrence(
    {
      recurrence: schedule.recurrence,
      timezone: schedule.timezone || DEFAULT_SCHEDULE_TIMEZONE,
      localHour: schedule.localHour,
      localMinute: schedule.localMinute,
      daysOfWeek: schedule.daysOfWeek,
      startAtUtc: schedule.startAtUtc,
      endAtUtc: schedule.endAtUtc,
    },
    afterUtc,
  );

  if (!next) {
    await ctx.db.patch("schedules", scheduleId, {
      nextOccurrenceAt: undefined,
      nextOccurrenceKey: undefined,
      schedulerJobId: undefined,
      updatedAt: Date.now(),
    });
    return null;
  }

  const occurrenceKey = buildOccurrenceKey({
    scheduleId,
    localDate: next.localDate,
    localHour: next.localHour,
    localMinute: next.localMinute,
    timezone: schedule.timezone,
  });

  const jobId: Id<"_scheduled_functions"> = await ctx.scheduler.runAt(
    next.at,
    internal.scheduleJobs.fireOccurrence,
    {
      scheduleId,
      occurrenceKey,
      scheduledAt: next.at,
    },
  );

  await ctx.db.patch("schedules", scheduleId, {
    nextOccurrenceAt: next.at,
    nextOccurrenceKey: occurrenceKey,
    schedulerJobId: jobId,
    updatedAt: Date.now(),
  });

  return { at: next.at, occurrenceKey, jobId };
}

type FireResult = {
  status: "started" | "deduplicated" | "skipped" | "disabled";
  runId?: Id<"runs">;
  reason?: string;
};

async function fireOccurrenceCore(
  ctx: MutationCtx,
  args: {
    scheduleId: Id<"schedules">;
    occurrenceKey: string;
    scheduledAt: number;
    manual?: boolean;
  },
): Promise<FireResult> {
  const schedule = await ctx.db.get("schedules", args.scheduleId);
  if (!schedule) {
    return { status: "disabled", reason: "Schedule missing" };
  }

  const organization = await ctx.db.get(
    "organizations",
    schedule.organizationId,
  );
  if (!organization) {
    return { status: "disabled", reason: "Organization missing" };
  }

  const limits = orgDelegationLimits(organization);
  if (!args.manual && (!schedule.enabled || !limits.schedulesEnabled)) {
    return {
      status: "disabled",
      reason: "Schedules disabled (org or schedule)",
    };
  }

  const existing = await ctx.db
    .query("scheduleOccurrences")
    .withIndex("by_occurrence_key", (q) =>
      q
        .eq("organizationId", schedule.organizationId)
        .eq("occurrenceKey", args.occurrenceKey),
    )
    .unique();
  if (existing?.runId) {
    return {
      status: "deduplicated",
      runId: existing.runId,
      reason: "Occurrence already claimed",
    };
  }

  if (
    schedule.concurrencyPolicy === "forbid" ||
    schedule.concurrencyPolicy === "skip_if_running"
  ) {
    const active = await ctx.db
      .query("scheduleOccurrences")
      .withIndex("by_schedule_and_status", (q) =>
        q.eq("scheduleId", schedule._id).eq("status", "running"),
      )
      .take(1);
    const claimed = await ctx.db
      .query("scheduleOccurrences")
      .withIndex("by_schedule_and_status", (q) =>
        q.eq("scheduleId", schedule._id).eq("status", "claimed"),
      )
      .take(1);
    if (active.length > 0 || claimed.length > 0) {
      const now = Date.now();
      if (!existing) {
        await ctx.db.insert("scheduleOccurrences", {
          organizationId: schedule.organizationId,
          scheduleId: schedule._id,
          occurrenceKey: args.occurrenceKey,
          scheduledAt: args.scheduledAt,
          status: "skipped",
          skipReason: "Concurrency policy: prior occurrence still active",
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch("scheduleOccurrences", existing._id, {
          status: "skipped",
          skipReason: "Concurrency policy: prior occurrence still active",
          updatedAt: now,
        });
      }
      if (!args.manual) {
        await armNextOccurrence(ctx, schedule._id, args.scheduledAt);
      }
      return {
        status: "skipped",
        reason: "Concurrency policy: prior occurrence still active",
      };
    }
  }

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_and_user", (q) =>
      q
        .eq("organizationId", schedule.organizationId)
        .eq("authUserId", schedule.principalAuthUserId),
    )
    .unique();
  if (!membership || membership.status !== "active") {
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("scheduleOccurrences", {
        organizationId: schedule.organizationId,
        scheduleId: schedule._id,
        occurrenceKey: args.occurrenceKey,
        scheduledAt: args.scheduledAt,
        status: "skipped",
        skipReason: "Principal membership inactive",
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!args.manual) {
      await armNextOccurrence(ctx, schedule._id, args.scheduledAt);
    }
    return { status: "skipped", reason: "Principal membership inactive" };
  }

  const now = Date.now();
  const occurrenceId =
    existing?._id ??
    (await ctx.db.insert("scheduleOccurrences", {
      organizationId: schedule.organizationId,
      scheduleId: schedule._id,
      occurrenceKey: args.occurrenceKey,
      scheduledAt: args.scheduledAt,
      status: "claimed",
      createdAt: now,
      updatedAt: now,
    }));
  if (existing) {
    await ctx.db.patch("scheduleOccurrences", occurrenceId, {
      status: "claimed",
      updatedAt: now,
    });
  }

  const runId = await ctx.db.insert("runs", {
    organizationId: schedule.organizationId,
    dealId: schedule.dealId,
    scheduleId: schedule._id,
    occurrenceKey: args.occurrenceKey,
    principalAuthUserId: schedule.principalAuthUserId,
    title: `[Schedule] ${schedule.name}`,
    assignmentPrompt: schedule.jobPrompt,
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

  await ctx.db.patch("scheduleOccurrences", occurrenceId, {
    status: "running",
    runId,
    updatedAt: Date.now(),
  });

  const workflowId: WorkflowId = await workflowManager.start(
    ctx,
    internal.workflows.scheduleWorkflow.scheduleWorkflow,
    {
      runId,
      organizationId: schedule.organizationId,
      principalAuthUserId: schedule.principalAuthUserId,
      scheduleId: schedule._id,
      occurrenceKey: args.occurrenceKey,
    },
  );

  await ctx.db.patch("runs", runId, {
    workflowId: String(workflowId),
    updatedAt: Date.now(),
  });

  await ctx.db.patch("schedules", schedule._id, {
    lastFiredAt: now,
    schedulerJobId: undefined,
    updatedAt: now,
  });

  await ctx.db.insert("auditEvents", {
    organizationId: schedule.organizationId,
    actorAuthUserId: schedule.principalAuthUserId,
    action: args.manual ? "schedule.manual_run" : "schedule.fired",
    targetType: "schedules",
    targetId: schedule._id,
    metadata: JSON.stringify({
      occurrenceKey: args.occurrenceKey,
      runId,
      dryRun: organization.outboundDryRun !== false,
    }),
    createdAt: now,
  });

  if (!args.manual) {
    await armNextOccurrence(ctx, schedule._id, args.scheduledAt);
  }

  return { status: "started", runId };
}

export const armNext = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    afterUtc: v.number(),
  },
  returns: v.union(
    v.object({
      at: v.number(),
      occurrenceKey: v.string(),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ at: number; occurrenceKey: string } | null> => {
    const result = await armNextOccurrence(ctx, args.scheduleId, args.afterUtc);
    if (!result) return null;
    return { at: result.at, occurrenceKey: result.occurrenceKey };
  },
});

export const fireOccurrence = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    occurrenceKey: v.string(),
    scheduledAt: v.number(),
    manual: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(
      v.literal("started"),
      v.literal("deduplicated"),
      v.literal("skipped"),
      v.literal("disabled"),
    ),
    runId: v.optional(v.id("runs")),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await fireOccurrenceCore(ctx, args);
  },
});

export const markOccurrenceTerminal = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    occurrenceKey: v.string(),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get("schedules", args.scheduleId);
    if (!schedule) return null;
    const occ = await ctx.db
      .query("scheduleOccurrences")
      .withIndex("by_occurrence_key", (q) =>
        q
          .eq("organizationId", schedule.organizationId)
          .eq("occurrenceKey", args.occurrenceKey),
      )
      .unique();
    if (!occ) return null;
    if (
      occ.status === "succeeded" ||
      occ.status === "canceled" ||
      occ.status === "skipped"
    ) {
      return null;
    }
    await ctx.db.patch("scheduleOccurrences", occ._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const reconcileMissed = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    nowUtc: v.number(),
  },
  returns: v.object({
    fired: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get("schedules", args.scheduleId);
    if (!schedule || !schedule.enabled) {
      return { fired: 0, skipped: 0 };
    }
    if (schedule.missedRunPolicy === "skip") {
      await armNextOccurrence(ctx, schedule._id, args.nowUtc);
      return { fired: 0, skipped: 0 };
    }

    let fired = 0;
    let skipped = 0;
    let after = schedule.lastFiredAt ?? schedule.createdAt;
    const maxCatchUp = schedule.missedRunPolicy === "catch_up_one" ? 1 : 10;

    for (let i = 0; i < maxCatchUp; i++) {
      const next = computeNextOccurrence(
        {
          recurrence: schedule.recurrence,
          timezone: schedule.timezone,
          localHour: schedule.localHour,
          localMinute: schedule.localMinute,
          daysOfWeek: schedule.daysOfWeek,
          startAtUtc: schedule.startAtUtc,
          endAtUtc: schedule.endAtUtc,
        },
        after,
      );
      if (!next || next.at > args.nowUtc) break;
      const occurrenceKey = buildOccurrenceKey({
        scheduleId: schedule._id,
        localDate: next.localDate,
        localHour: next.localHour,
        localMinute: next.localMinute,
        timezone: schedule.timezone,
      });
      const result = await fireOccurrenceCore(ctx, {
        scheduleId: schedule._id,
        occurrenceKey,
        scheduledAt: next.at,
      });
      if (result.status === "started") fired++;
      else skipped++;
      after = next.at;
      if (schedule.missedRunPolicy === "catch_up_one") break;
    }

    await armNextOccurrence(ctx, schedule._id, args.nowUtc);
    return { fired, skipped };
  },
});

/** Exported for schedules.ts create/enable paths. */
export { armNextOccurrence, fireOccurrenceCore };
