import type { Doc, Id } from "../_generated/dataModel";

export type AssociationDecision =
  | { kind: "matched"; dealId: Id<"deals"> }
  | { kind: "ambiguous"; candidateDealIds: Id<"deals">[]; reason: string }
  | { kind: "unmatched"; reason: string };

/**
 * Never auto-associate a sensitive deal from a fuzzy-only name match.
 * Exact subject/title or explicit dealHint id wins; multiple partials → review.
 */
export function resolveDealAssociation(input: {
  deals: Doc<"deals">[];
  subject: string;
  from: string;
  dealHint?: string;
  text?: string;
}): AssociationDecision {
  const deals = input.deals;
  if (input.dealHint) {
    const byId = deals.find((d) => d._id === input.dealHint);
    if (byId) {
      return { kind: "matched", dealId: byId._id };
    }
    const byTitle = deals.find(
      (d) => d.title.toLowerCase() === input.dealHint!.toLowerCase(),
    );
    if (byTitle) {
      return { kind: "matched", dealId: byTitle._id };
    }
  }

  const subject = input.subject.toLowerCase();
  const exact = deals.filter(
    (d) =>
      subject.includes(d.title.toLowerCase()) &&
      d.title.trim().length >= 8,
  );
  if (exact.length === 1) {
    return { kind: "matched", dealId: exact[0]!._id };
  }
  if (exact.length > 1) {
    return {
      kind: "ambiguous",
      candidateDealIds: exact.map((d) => d._id),
      reason: "Multiple deals match the email subject exactly/partially",
    };
  }

  // Fuzzy token overlap — never auto-associate
  const tokens = subject.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const fuzzy = deals.filter((d) => {
    const titleTokens = d.title.toLowerCase().split(/[^a-z0-9]+/);
    return tokens.some((t) => titleTokens.includes(t));
  });
  if (fuzzy.length >= 1) {
    return {
      kind: "ambiguous",
      candidateDealIds: fuzzy.map((d) => d._id),
      reason:
        "Fuzzy name match only — requires human review before deal association",
    };
  }

  return {
    kind: "unmatched",
    reason: `No deal association for sender ${input.from}`,
  };
}
