import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";
import { dealStatusValidator } from "./schema";

const dealReturn = v.object({
  _id: v.id("deals"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  title: v.string(),
  ownerAuthUserId: v.string(),
  status: dealStatusValidator,
  externalCRMRef: v.optional(v.string()),
  summary: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const list = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(dealStatusValidator),
  },
  returns: v.array(dealReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    let deals;
    if (args.status) {
      deals = await ctx.db
        .query("deals")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", args.status!),
        )
        .collect();
    } else {
      deals = await ctx.db
        .query("deals")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();
    }
    return deals.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: {
    organizationId: v.id("organizations"),
    dealId: v.id("deals"),
  },
  returns: v.union(dealReturn, v.null()),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const deal = await ctx.db.get("deals", args.dealId);
    if (!deal || deal.organizationId !== args.organizationId) {
      return null;
    }
    return deal;
  },
});

export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    summary: v.optional(v.string()),
    externalCRMRef: v.optional(v.string()),
  },
  returns: v.id("deals"),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const now = Date.now();
    const dealId = await ctx.db.insert("deals", {
      organizationId: args.organizationId,
      title: args.title.trim(),
      ownerAuthUserId: user.id,
      status: "intake",
      summary: args.summary,
      externalCRMRef: args.externalCRMRef,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "deal.created",
      targetType: "deals",
      targetId: dealId,
      createdAt: now,
    });
    return dealId;
  },
});

export const update = mutation({
  args: {
    organizationId: v.id("organizations"),
    dealId: v.id("deals"),
    title: v.optional(v.string()),
    status: v.optional(dealStatusValidator),
    summary: v.optional(v.string()),
    externalCRMRef: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const deal = await ctx.db.get("deals", args.dealId);
    if (!deal || deal.organizationId !== args.organizationId) {
      throw new Error("Deal not found");
    }
    const patch: {
      title?: string;
      status?: typeof args.status;
      summary?: string;
      externalCRMRef?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.status !== undefined) patch.status = args.status;
    if (args.summary !== undefined) patch.summary = args.summary;
    if (args.externalCRMRef !== undefined) {
      patch.externalCRMRef = args.externalCRMRef;
    }
    await ctx.db.patch("deals", args.dealId, patch);
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "deal.updated",
      targetType: "deals",
      targetId: args.dealId,
      metadata: JSON.stringify(patch),
      createdAt: Date.now(),
    });
    return null;
  },
});
