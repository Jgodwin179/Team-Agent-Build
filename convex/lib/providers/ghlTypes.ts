/**
 * GHL (GoHighLevel) typed wrappers.
 * Scopes verified from marketplace.gohighlevel.com/docs/Authorization/Scopes:
 * - contacts.readonly / contacts.write (notes via POST /contacts/:id/notes)
 * - opportunities.readonly / opportunities.write
 * Base API host documented as https://services.leadconnectorhq.com
 */

export type GhlMode = "mock" | "live" | "dry-run";

export type GhlContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

export type GhlOpportunity = {
  id: string;
  name: string;
  status?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  monetaryValue?: number;
};

export type GhlNoteProposal = {
  actionType: "ghl.add_note";
  contactId: string;
  body: string;
  locationId?: string;
};

export type GhlOpportunityUpdateProposal = {
  actionType: "ghl.update_opportunity";
  opportunityId: string;
  /** Only allowlisted fields may be proposed. */
  patch: {
    name?: string;
    status?: string;
    pipelineStageId?: string;
    monetaryValue?: number;
  };
};

export type GhlProposal = GhlNoteProposal | GhlOpportunityUpdateProposal;

export const GHL_READ_SCOPES = [
  "contacts.readonly",
  "opportunities.readonly",
] as const;

export const GHL_WRITE_SCOPES = [
  "contacts.write",
  "opportunities.write",
] as const;

export const GHL_ALLOWED_OPPORTUNITY_FIELDS = [
  "name",
  "status",
  "pipelineStageId",
  "monetaryValue",
] as const;

export type GhlCrmClient = {
  readonly mode: GhlMode;
  getContact(contactId: string): Promise<GhlContact>;
  searchOpportunities(input: {
    locationId: string;
    query?: string;
    limit?: number;
  }): Promise<{ items: GhlOpportunity[]; mode: GhlMode; mockLabel?: string }>;
  /**
   * Never called for live writes in Phase 3 without approval + dry-run gate.
   * Implementations must refuse when dryRun is true by returning a dry-run receipt.
   */
  executeApproved(
    proposal: GhlProposal,
    options: { dryRun: boolean; approvalId: string },
  ): Promise<{
    status: "dry_run" | "sent" | "failed";
    externalId?: string;
    detail: string;
  }>;
};
