/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_researchAgent from "../agents/researchAgent.js";
import type * as approvals from "../approvals.js";
import type * as assignments from "../assignments.js";
import type * as auth from "../auth.js";
import type * as boxActions from "../boxActions.js";
import type * as connections from "../connections.js";
import type * as crm from "../crm.js";
import type * as deals from "../deals.js";
import type * as documentActions from "../documentActions.js";
import type * as documents from "../documents.js";
import type * as ghlActions from "../ghlActions.js";
import type * as http from "../http.js";
import type * as lib_documentAccess from "../lib/documentAccess.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_pdf_types from "../lib/pdf/types.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_providers_boxMock from "../lib/providers/boxMock.js";
import type * as lib_providers_fileSource from "../lib/providers/fileSource.js";
import type * as lib_providers_ghlMock from "../lib/providers/ghlMock.js";
import type * as lib_providers_ghlTypes from "../lib/providers/ghlTypes.js";
import type * as lib_runTransitions from "../lib/runTransitions.js";
import type * as organizations from "../organizations.js";
import type * as runSteps from "../runSteps.js";
import type * as runs from "../runs.js";
import type * as seed from "../seed.js";
import type * as tools from "../tools.js";
import type * as workflows_assignmentWorkflow from "../workflows/assignmentWorkflow.js";
import type * as workflows_manager from "../workflows/manager.js";
import type * as workflows_onComplete from "../workflows/onComplete.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/researchAgent": typeof agents_researchAgent;
  approvals: typeof approvals;
  assignments: typeof assignments;
  auth: typeof auth;
  boxActions: typeof boxActions;
  connections: typeof connections;
  crm: typeof crm;
  deals: typeof deals;
  documentActions: typeof documentActions;
  documents: typeof documents;
  ghlActions: typeof ghlActions;
  http: typeof http;
  "lib/documentAccess": typeof lib_documentAccess;
  "lib/hash": typeof lib_hash;
  "lib/pdf/types": typeof lib_pdf_types;
  "lib/permissions": typeof lib_permissions;
  "lib/providers/boxMock": typeof lib_providers_boxMock;
  "lib/providers/fileSource": typeof lib_providers_fileSource;
  "lib/providers/ghlMock": typeof lib_providers_ghlMock;
  "lib/providers/ghlTypes": typeof lib_providers_ghlTypes;
  "lib/runTransitions": typeof lib_runTransitions;
  organizations: typeof organizations;
  runSteps: typeof runSteps;
  runs: typeof runs;
  seed: typeof seed;
  tools: typeof tools;
  "workflows/assignmentWorkflow": typeof workflows_assignmentWorkflow;
  "workflows/manager": typeof workflows_manager;
  "workflows/onComplete": typeof workflows_onComplete;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
