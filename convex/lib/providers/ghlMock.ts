import type {
  GhlContact,
  GhlCrmClient,
  GhlOpportunity,
  GhlProposal,
} from "./ghlTypes";

const MOCK_LABEL = "MOCK — local GHL fixture (no live CRM call)";

const CONTACTS: Record<string, GhlContact> = {
  "mock-contact-1": {
    id: "mock-contact-1",
    firstName: "Alex",
    lastName: "Seller",
    email: "alex.seller@example.test",
    phone: "+15555550100",
  },
  "mock-contact-denied": {
    id: "mock-contact-denied",
    firstName: "Denied",
    lastName: "Scope",
    email: "denied@example.test",
  },
};

const OPPORTUNITIES: GhlOpportunity[] = [
  {
    id: "mock-opp-1",
    name: "Midwest Manufacturing — Sell-side",
    status: "open",
    pipelineId: "mock-pipe-1",
    pipelineStageId: "mock-stage-qualified",
    contactId: "mock-contact-1",
    monetaryValue: 4_200_000,
  },
  {
    id: "mock-opp-2",
    name: "Peer deal (wrong location fixture)",
    status: "open",
    contactId: "mock-contact-1",
    monetaryValue: 1,
  },
];

export function createMockGhlClient(options?: {
  forceExpired?: boolean;
  deniedScopes?: string[];
}): GhlCrmClient {
  return {
    mode: "mock",

    async getContact(contactId) {
      if (options?.forceExpired) {
        throw new Error("MOCK: GHL auth expired — reconnect required");
      }
      if (
        contactId === "mock-contact-denied" ||
        options?.deniedScopes?.includes("contacts.readonly")
      ) {
        throw new Error("MOCK: denied scope contacts.readonly");
      }
      const contact = CONTACTS[contactId];
      if (!contact) {
        throw new Error(`MOCK: contact ${contactId} not found`);
      }
      return contact;
    },

    async searchOpportunities(input) {
      if (options?.forceExpired) {
        throw new Error("MOCK: GHL auth expired on opportunity search");
      }
      if (options?.deniedScopes?.includes("opportunities.readonly")) {
        throw new Error("MOCK: denied scope opportunities.readonly");
      }
      const limit = Math.min(input.limit ?? 20, 50);
      let items = OPPORTUNITIES;
      if (input.query) {
        const q = input.query.toLowerCase();
        items = items.filter((o) => o.name.toLowerCase().includes(q));
      }
      return {
        items: items.slice(0, limit),
        mode: "mock",
        mockLabel: MOCK_LABEL,
      };
    },

    async executeApproved(proposal, execOptions) {
      if (!execOptions.dryRun) {
        // Phase 3 hard gate: live CRM writes are not enabled in this slice.
        return {
          status: "failed",
          detail:
            "Live GHL writes are disabled in Phase 3. Keep dry-run / ALLOW_LIVE_CRM_WRITES unset.",
        };
      }
      return {
        status: "dry_run",
        externalId: `dryrun_${execOptions.approvalId}`,
        detail: `${MOCK_LABEL}; would execute ${proposal.actionType}`,
      };
    },
  };
}

export function summarizeProposal(proposal: GhlProposal): string {
  if (proposal.actionType === "ghl.add_note") {
    return `Add note to contact ${proposal.contactId}: ${proposal.body.slice(0, 120)}`;
  }
  return `Update opportunity ${proposal.opportunityId}: ${JSON.stringify(proposal.patch)}`;
}
