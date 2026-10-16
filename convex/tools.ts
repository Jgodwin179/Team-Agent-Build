import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

const dealSnippet = v.object({
  id: v.id("deals"),
  title: v.string(),
  status: v.string(),
  summary: v.optional(v.string()),
});

type DealSnippet = {
  id: Id<"deals">;
  title: string;
  status: string;
  summary?: string;
};

/**
 * Idempotent read-only tool used by the assignment agent.
 * Persists a toolExecution row keyed by runId+stepKey so workflow resume
 * does not duplicate ledger writes.
 */
export const listOrgDealsInternal = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
    limit: v.number(),
    stepKey: v.string(),
  },
  returns: v.object({
    deals: v.array(dealSnippet),
    reusedExisting: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("toolExecutions")
      .withIndex("by_run_and_step", (q) =>
        q.eq("runId", args.runId).eq("stepKey", args.stepKey),
      )
      .unique();

    if (existing?.status === "succeeded" && existing.resultJson) {
      const parsed = JSON.parse(existing.resultJson) as { deals: DealSnippet[] };
      return { deals: parsed.deals, reusedExisting: true };
    }

    const started = Date.now();
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .take(args.limit);

    const payload = {
      deals: deals.map(
        (d): DealSnippet => ({
          id: d._id,
          title: d.title,
          status: d.status,
          summary: d.summary,
        }),
      ),
    };

    if (existing) {
      await ctx.db.patch("toolExecutions", existing._id, {
        status: "succeeded",
        resultJson: JSON.stringify(payload),
        durationMs: Date.now() - started,
      });
    } else {
      await ctx.db.insert("toolExecutions", {
        organizationId: args.organizationId,
        runId: args.runId,
        stepKey: args.stepKey,
        toolName: "listOrgDeals",
        toolVersion: "1",
        classification: "read",
        argsJson: JSON.stringify({ limit: args.limit }),
        resultJson: JSON.stringify(payload),
        status: "succeeded",
        durationMs: Date.now() - started,
        createdAt: started,
      });
    }

    return { ...payload, reusedExisting: false };
  },
});
