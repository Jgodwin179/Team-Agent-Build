import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";
import {
  concurrencyPolicyValidator,
  missedRunPolicyValidator,
  occurrenceStatusValidator,
  scheduleRecurrenceValidator,
} from "./schema";
import {
  buildOccurrenceKey,
  computeNextOccurrence,
  DEFAULT_SCHEDULE_TIMEZONE,
  getLocalParts,
} from "./lib/timezone";
import { orgDelegationLimits } from "./lib/delegationLimits";
import {
  armNextOccurrence,
  fireOccurrenceCore,
} from "./scheduleJobs";

const scheduleReturn = v.object({
  _id: v.id("schedules"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  name: v.string(),
  description: v.optional(v.string()),
  timezone: v.string(),
  recurrence: scheduleRecurrenceValidator,
  localHour: v.number(),
  localMinute: v.number(),
  daysOfWeek: v.optional(v.array(v.number())),
  startAtUtc: v.optional(v.number()),
  endAtUtc: v.optional(v.number()),
  jobPrompt: v.string(),
  dealId: v.optional(v.id("deals")),
  authorizedByAuthUserId: v.string(),
  principalAuthUserId: v.string(),
  enabled: v.boolean(),
  missedRunPolicy: missedRunPolicyValidator,
  concurrencyPolicy: concurrencyPolicyValidator,
  nextOccurrenceAt: v.optional(v.number()),
  nextOccurrenceKey: v.optional(v.string()),
  lastFiredAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const list = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(scheduleReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const rows = await ctx.db
      .query("schedules")
      .withIndex("by_org_and_enabled", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: {
    organizationId: v.id("organizations"),
    scheduleId: v.id("schedules"),
  },
  returns: v.union(scheduleReturn, v.null()),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const row = await ctx.db.get("schedules", args.scheduleId);
    if (!row || row.organizationId !== args.organizationId) return null;
    return row;
  },
});

export const previewNext = query({
  args: {
    organizationId: v.id("organizations"),
    timezone: v.optional(v.string()),
    recurrence: scheduleRecurrenceValidator,
    localHour: v.number(),
    localMinute: v.number(),
    daysOfWeek: v.optional(v.array(v.number())),
    startAtUtc: v.optional(v.number()),
    endAtUtc: v.optional(v.number()),
    afterUtc: v.optional(v.number()),
    count: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      at: v.number(),
      localDate: v.string(),
      localLabel: v.string(),
      occurrenceKeyPreview: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const tz = args.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
    const count = Math.min(args.count ?? 5, 20);
    const results: Array<{
      at: number;
      localDate: string;
      localLabel: string;
      occurrenceKeyPreview: string;
    }> = [];
    let after = args.afterUtc ?? Date.now();
    for (let i = 0; i < count; i++) {
      const next = computeNextOccurrence(
        {
          recurrence: args.recurrence,
          timezone: tz,
          localHour: args.localHour,
          localMinute: args.localMinute,
          daysOfWeek: args.daysOfWeek,
          startAtUtc: args.startAtUtc,
          endAtUtc: args.endAtUtc,
        },
        after,
      );
      if (!next) break;
      results.push({
        at: next.at,
        localDate: next.localDate,
        localLabel: `${next.localDate} ${String(next.localHour).padStart(2, "0")}:${String(next.localMinute).padStart(2, "0")} ${tz}`,
        occurrenceKeyPreview: buildOccurrenceKey({
          scheduleId: "preview",
          localDate: next.localDate,
          localHour: next.localHour,
          localMinute: next.localMinute,
          timezone: tz,
        }),
      });
      after = next.at;
    }
    return results;
  },
});

export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    timezone: v.optional(v.string()),
    recurrence: scheduleRecurrenceValidator,
    localHour: v.number(),
    localMinute: v.number(),
    daysOfWeek: v.optional(v.array(v.number())),
    startAtUtc: v.optional(v.number()),
    endAtUtc: v.optional(v.number()),
    jobPrompt: v.string(),
    dealId: v.optional(v.id("deals")),
    missedRunPolicy: v.optional(missedRunPolicyValidator),
    concurrencyPolicy: v.optional(concurrencyPolicyValidator),
    /** Schedules are created disabled by default in development. */
    enabled: v.optional(v.boolean()),
  },
  returns: v.id("schedules"),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    if (args.localHour < 0 || args.localHour > 23) {
      throw new Error("localHour must be 0–23");
    }
    if (args.localMinute < 0 || args.localMinute > 59) {
      throw new Error("localMinute must be 0–59");
    }
    if (args.dealId) {
      const deal = await ctx.db.get("deals", args.dealId);
      if (!deal || deal.organizationId !== args.organizationId) {
        throw new Error("Deal not found");
      }
    }

    const now = Date.now();
    const timezone = args.timezone ?? organization.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
    // Dev default: disabled unless org.schedulesEnabled AND caller asks enabled.
    const orgAllows = orgDelegationLimits(organization).schedulesEnabled;
    const enabled = orgAllows && args.enabled === true;

    const scheduleId = await ctx.db.insert("schedules", {
      organizationId: args.organizationId,
      name: args.name.trim(),
      description: args.description,
      timezone,
      recurrence: args.recurrence,
      localHour: args.localHour,
      localMinute: args.localMinute,
      daysOfWeek: args.daysOfWeek,
      startAtUtc: args.startAtUtc,
      endAtUtc: args.endAtUtc,
      jobPrompt: args.jobPrompt.trim(),
      dealId: args.dealId,
      authorizedByAuthUserId: user.id,
      principalAuthUserId: user.id,
      enabled,
      missedRunPolicy: args.missedRunPolicy ?? "skip",
      concurrencyPolicy: args.concurrencyPolicy ?? "forbid",
      createdAt: now,
      updatedAt: now,
    });

    if (enabled) {
      await armNextOccurrence(ctx, scheduleId, now);
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "schedule.created",
      targetType: "schedules",
      targetId: scheduleId,
      metadata: JSON.stringify({ enabled, timezone }),
      createdAt: now,
    });

    return scheduleId;
  },
});

export const setEnabled = mutation({
  args: {
    organizationId: v.id("organizations"),
    scheduleId: v.id("schedules"),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    const schedule = await ctx.db.get("schedules", args.scheduleId);
    if (!schedule || schedule.organizationId !== args.organizationId) {
      throw new Error("Schedule not found");
    }

    if (args.enabled && !orgDelegationLimits(organization).schedulesEnabled) {
      throw new Error(
        "Organization schedules are disabled. Enable org setting schedulesEnabled first (admin).",
      );
    }

    const now = Date.now();
    if (!args.enabled) {
      if (schedule.schedulerJobId) {
        try {
          await ctx.scheduler.cancel(schedule.schedulerJobId);
        } catch {
          // ignore
        }
      }
      await ctx.db.patch("schedules", schedule._id, {
        enabled: false,
        nextOccurrenceAt: undefined,
        nextOccurrenceKey: undefined,
        schedulerJobId: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch("schedules", schedule._id, {
        enabled: true,
        updatedAt: now,
      });
      // Cancel prior job (above) + arm next is transactional in this mutation.
      // Missed catch-up: skip policy arms from now; catch_up_* fires overdue keys.
      if (schedule.missedRunPolicy === "skip") {
        await armNextOccurrence(ctx, schedule._id, now);
      } else {
        let after = schedule.lastFiredAt ?? schedule.createdAt;
        const maxCatchUp =
          schedule.missedRunPolicy === "catch_up_one" ? 1 : 10;
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
          if (!next || next.at > now) break;
          const occurrenceKey = buildOccurrenceKey({
            scheduleId: schedule._id,
            localDate: next.localDate,
            localHour: next.localHour,
            localMinute: next.localMinute,
            timezone: schedule.timezone,
          });
          await fireOccurrenceCore(ctx, {
            scheduleId: schedule._id,
            occurrenceKey,
            scheduledAt: next.at,
          });
          after = next.at;
          if (schedule.missedRunPolicy === "catch_up_one") break;
        }
        await armNextOccurrence(ctx, schedule._id, now);
      }
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: args.enabled ? "schedule.enabled" : "schedule.disabled",
      targetType: "schedules",
      targetId: schedule._id,
      createdAt: now,
    });
    return null;
  },
});

export const setOrgSchedulesEnabled = mutation({
  args: {
    organizationId: v.id("organizations"),
    schedulesEnabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    await ctx.db.patch("organizations", organization._id, {
      settings: {
        ...organization.settings,
        schedulesEnabled: args.schedulesEnabled,
      },
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "org.schedulesEnabled",
      targetType: "organizations",
      targetId: organization._id,
      metadata: JSON.stringify({ schedulesEnabled: args.schedulesEnabled }),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const reschedule = mutation({
  args: {
    organizationId: v.id("organizations"),
    scheduleId: v.id("schedules"),
    localHour: v.optional(v.number()),
    localMinute: v.optional(v.number()),
    daysOfWeek: v.optional(v.array(v.number())),
    recurrence: v.optional(scheduleRecurrenceValidator),
    timezone: v.optional(v.string()),
    jobPrompt: v.optional(v.string()),
    missedRunPolicy: v.optional(missedRunPolicyValidator),
    concurrencyPolicy: v.optional(concurrencyPolicyValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const schedule = await ctx.db.get("schedules", args.scheduleId);
    if (!schedule || schedule.organizationId !== args.organizationId) {
      throw new Error("Schedule not found");
    }

    const now = Date.now();
    if (schedule.schedulerJobId) {
      try {
        await ctx.scheduler.cancel(schedule.schedulerJobId);
      } catch {
        // ignore
      }
    }

    await ctx.db.patch("schedules", schedule._id, {
      localHour: args.localHour ?? schedule.localHour,
      localMinute: args.localMinute ?? schedule.localMinute,
      daysOfWeek: args.daysOfWeek ?? schedule.daysOfWeek,
      recurrence: args.recurrence ?? schedule.recurrence,
      timezone: args.timezone ?? schedule.timezone,
      jobPrompt: args.jobPrompt ?? schedule.jobPrompt,
      missedRunPolicy: args.missedRunPolicy ?? schedule.missedRunPolicy,
      concurrencyPolicy: args.concurrencyPolicy ?? schedule.concurrencyPolicy,
      schedulerJobId: undefined,
      updatedAt: now,
    });

    if (schedule.enabled) {
      await armNextOccurrence(ctx, schedule._id, now);
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "schedule.rescheduled",
      targetType: "schedules",
      targetId: schedule._id,
      createdAt: now,
    });
    return null;
  },
});

export const runNow = mutation({
  args: {
    organizationId: v.id("organizations"),
    scheduleId: v.id("schedules"),
  },
  returns: v.object({
    status: v.string(),
    runId: v.optional(v.id("runs")),
    occurrenceKey: v.string(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "member");
    const schedule = await ctx.db.get("schedules", args.scheduleId);
    if (!schedule || schedule.organizationId !== args.organizationId) {
      throw new Error("Schedule not found");
    }
    const now = Date.now();
    const local = getLocalParts(now, schedule.timezone);
    // Manual runs use a distinct key so they don't collide with scheduled keys.
    const occurrenceKey = `${schedule._id}|manual|${now}`;
    const result = await fireOccurrenceCore(ctx, {
      scheduleId: schedule._id,
      occurrenceKey,
      scheduledAt: now,
      manual: true,
    });
    return {
      status: result.status,
      runId: result.runId,
      occurrenceKey,
      reason: result.reason ?? `manual @ ${local.year}-${local.month}-${local.day}`,
    };
  },
});

export const listOccurrences = query({
  args: {
    organizationId: v.id("organizations"),
    scheduleId: v.id("schedules"),
  },
  returns: v.array(
    v.object({
      _id: v.id("scheduleOccurrences"),
      occurrenceKey: v.string(),
      scheduledAt: v.number(),
      status: occurrenceStatusValidator,
      runId: v.optional(v.id("runs")),
      skipReason: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const schedule = await ctx.db.get("schedules", args.scheduleId);
    if (!schedule || schedule.organizationId !== args.organizationId) {
      return [];
    }
    const rows = await ctx.db
      .query("scheduleOccurrences")
      .withIndex("by_schedule_and_status", (q) =>
        q.eq("scheduleId", args.scheduleId),
      )
      .collect();
    return rows
      .sort((a, b) => b.scheduledAt - a.scheduledAt)
      .slice(0, 50)
      .map((r) => ({
        _id: r._id,
        occurrenceKey: r.occurrenceKey,
        scheduledAt: r.scheduledAt,
        status: r.status,
        runId: r.runId,
        skipReason: r.skipReason,
        createdAt: r.createdAt,
      }));
  },
});

export const getOrgScheduleFlags = query({
  args: { organizationId: v.id("organizations") },
  returns: v.object({
    schedulesEnabled: v.boolean(),
    timezone: v.string(),
    outboundDryRun: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "viewer",
    );
    return {
      schedulesEnabled: orgDelegationLimits(organization).schedulesEnabled,
      timezone: organization.timezone || DEFAULT_SCHEDULE_TIMEZONE,
      outboundDryRun: organization.outboundDryRun !== false,
    };
  },
});
