import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

export type Role = "owner" | "admin" | "member" | "viewer";

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export type AuthedMembership = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  membership: Doc<"memberships">;
  organization: Doc<"organizations">;
};

type DbCtx = QueryCtx | MutationCtx;

export async function requireAuthUser(ctx: DbCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }
  return {
    id: user._id,
    name: user.name,
    email: user.email,
  };
}

export async function getActiveMembership(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
  authUserId: string,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_org_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("authUserId", authUserId),
    )
    .unique();
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function canWrite(role: Role): boolean {
  return roleAtLeast(role, "member");
}

export function canAdmin(role: Role): boolean {
  return roleAtLeast(role, "admin");
}

/**
 * Resolve identity server-side. organizationId is a selector only —
 * membership + active status are the authority.
 */
export async function requireOrgAccess(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
  minimumRole: Role = "viewer",
): Promise<AuthedMembership> {
  const user = await requireAuthUser(ctx);
  const organization = await ctx.db.get("organizations", organizationId);
  if (!organization || organization.status !== "active") {
    throw new Error("Organization not found");
  }

  const membership = await getActiveMembership(ctx, organizationId, user.id);
  if (!membership || membership.status !== "active") {
    throw new Error("Unauthorized: not a member of this organization");
  }

  if (!roleAtLeast(membership.role, minimumRole)) {
    throw new Error(`Unauthorized: requires ${minimumRole} role`);
  }

  return { user, membership, organization };
}

export async function listActiveMembershipsForUser(
  ctx: DbCtx,
  authUserId: string,
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("authUserId", authUserId))
    .collect();
  return memberships.filter((m) => m.status === "active");
}
