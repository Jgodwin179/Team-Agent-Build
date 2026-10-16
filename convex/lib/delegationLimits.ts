import type { Doc } from "../_generated/dataModel";

export const DEFAULT_MAX_DELEGATION_DEPTH = 1;
export const DEFAULT_MAX_CHILDREN_PER_RUN = 4;
export const DEFAULT_MAX_PARALLEL_CHILDREN = 2;

export function orgDelegationLimits(organization: Doc<"organizations">) {
  const s = organization.settings;
  return {
    maxDelegationDepth: s.maxDelegationDepth ?? DEFAULT_MAX_DELEGATION_DEPTH,
    maxChildrenPerRun: s.maxChildrenPerRun ?? DEFAULT_MAX_CHILDREN_PER_RUN,
    maxParallelChildren: s.maxParallelChildren ?? DEFAULT_MAX_PARALLEL_CHILDREN,
    allowRecursiveDelegation: s.allowRecursiveDelegation === true,
    schedulesEnabled: s.schedulesEnabled === true,
  };
}
