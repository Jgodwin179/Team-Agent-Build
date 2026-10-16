import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  canAdmin,
  listActiveMembershipsForUser,
  requireAuthUser,
  requireOrgAccess,
} from "./lib/permissions";
import {
  membershipStatusValidator,
  organizationStatusValidator,
  roleValidator,
} from "./schema";

const orgReturn = v.object({
  _id: v.id("organizations"),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.string(),
  timezone: v.string(),
  status: organizationStatusValidator,
  outboundDryRun: v.boolean(),
  isTestOrganization: v.boolean(),
  settings: v.object({
    defaultBudgetTokens: v.optional(v.number()),
    maxAgentSteps: v.optional(v.number()),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
  role: roleValidator,
});

export const listMine = query({
  args: {},
  returns: v.array(orgReturn),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const memberships = await listActiveMembershipsForUser(ctx, user.id);
    const results = [];
    for (const membership of memberships) {
      const organization = await ctx.db.get(
        "organizations",
        membership.organizationId,
      );
      if (!organization || organization.status !== "active") {
        continue;
      }
      results.push({
        ...organization,
        role: membership.role,
      });
    }
    return results;
  },
});

export const get = query({
  args: { organizationId: v.id("organizations") },
  returns: v.union(orgReturn, v.null()),
  handler: async (ctx, args) => {
    try {
      const { organization, membership } = await requireOrgAccess(
        ctx,
        args.organizationId,
        "viewer",
      );
      return { ...organization, role: membership.role };
    } catch {
      return null;
    }
  },
});

export const listMembers = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(
    v.object({
      _id: v.id("memberships"),
      authUserId: v.string(),
      role: roleValidator,
      status: membershipStatusValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org_and_user", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    return memberships.map((m) => ({
      _id: m._id,
      authUserId: m.authUserId,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt,
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    timezone: v.optional(v.string()),
    isTestOrganization: v.optional(v.boolean()),
  },
  returns: v.id("organizations"),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const slug = args.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) {
      throw new Error("Organization slug already exists");
    }

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: args.name,
      slug,
      timezone: args.timezone ?? "America/New_York",
      status: "active",
      outboundDryRun: true,
      isTestOrganization: args.isTestOrganization ?? false,
      settings: {
        defaultBudgetTokens: 50_000,
        maxAgentSteps: 12,
      },
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("memberships", {
      organizationId,
      authUserId: user.id,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      organizationId,
      actorAuthUserId: user.id,
      action: "organization.created",
      targetType: "organizations",
      targetId: organizationId,
      createdAt: now,
    });

    return organizationId;
  },
});

export const updateSettings = mutation({
  args: {
    organizationId: v.id("organizations"),
    outboundDryRun: v.optional(v.boolean()),
    timezone: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, membership } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    if (!canAdmin(membership.role)) {
      throw new Error("Unauthorized: admin access required");
    }

    const patch: {
      outboundDryRun?: boolean;
      timezone?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.outboundDryRun !== undefined) {
      patch.outboundDryRun = args.outboundDryRun;
    }
    if (args.timezone !== undefined) {
      patch.timezone = args.timezone;
    }

    await ctx.db.patch("organizations", args.organizationId, patch);
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "organization.settings_updated",
      targetType: "organizations",
      targetId: args.organizationId,
      metadata: JSON.stringify(patch),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const revokeMembership = mutation({
  args: {
    organizationId: v.id("organizations"),
    membershipId: v.id("memberships"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const membership = await ctx.db.get("memberships", args.membershipId);
    if (!membership || membership.organizationId !== args.organizationId) {
      throw new Error("Membership not found");
    }
    if (membership.role === "owner") {
      throw new Error("Cannot revoke the owner membership");
    }
    const now = Date.now();
    await ctx.db.patch("memberships", args.membershipId, {
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "membership.revoked",
      targetType: "memberships",
      targetId: args.membershipId,
      createdAt: now,
    });
    return null;
  },
});

export const addMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    authUserId: v.string(),
    role: roleValidator,
  },
  returns: v.id("memberships"),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    if (args.role === "owner") {
      throw new Error("Cannot assign owner role via addMember");
    }
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_org_and_user", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("authUserId", args.authUserId),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("memberships", existing._id, {
        role: args.role,
        status: "active",
        revokedAt: undefined,
        updatedAt: now,
      });
      return existing._id;
    }
    const membershipId = await ctx.db.insert("memberships", {
      organizationId: args.organizationId,
      authUserId: args.authUserId,
      role: args.role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "membership.added",
      targetType: "memberships",
      targetId: membershipId,
      createdAt: now,
    });
    return membershipId;
  },
});
