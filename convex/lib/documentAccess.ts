import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

/**
 * Documents are org-scoped; deal association further restricts retrieval.
 * Cross-deal reads must fail closed when a dealId selector is provided.
 */
export async function requireDocumentInOrg(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
  documentId: Id<"documents">,
  options?: { dealId?: Id<"deals"> },
): Promise<Doc<"documents">> {
  const doc = await ctx.db.get("documents", documentId);
  if (!doc || doc.organizationId !== organizationId) {
    throw new Error("Document not found");
  }
  if (options?.dealId !== undefined) {
    if (doc.dealId !== options.dealId) {
      throw new Error(
        "Unauthorized: document is not associated with the requested deal",
      );
    }
  }
  return doc;
}
