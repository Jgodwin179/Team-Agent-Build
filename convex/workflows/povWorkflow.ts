import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { resolveModelMode } from "../agents/researchAgent";
import { workflowManager } from "./manager";

/**
 * Seller PDF proof-of-value workflow (dry-run):
 * markRunning → (optional wait for association) → extract PDF →
 * propose GHL note → inbox + SMS dry-run notify → wait for approval
 * (execution is user-driven via approvals.executeApproved).
 */
export const povWorkflow = workflowManager.define({
  args: {
    runId: v.id("runs"),
    organizationId: v.id("organizations"),
    principalAuthUserId: v.string(),
    waitForAssociation: v.boolean(),
  },
  returns: v.object({
    status: v.union(
      v.literal("succeeded"),
      v.literal("canceled"),
      v.literal("failed"),
      v.literal("waiting_for_approval"),
    ),
  }),
  handler: async (
    step,
    args,
  ): Promise<{
    status: "succeeded" | "canceled" | "failed" | "waiting_for_approval";
  }> => {
    const modelMode = resolveModelMode();

    const started: { canceled: boolean; alreadyDone: boolean } =
      await step.runMutation(
        internal.runSteps.markRunning,
        {
          runId: args.runId,
          workflowId: step.workflowId,
          modelMode,
        },
        { name: "markRunning" },
      );
    if (started.canceled || started.alreadyDone) {
      return {
        status: started.canceled
          ? ("canceled" as const)
          : ("succeeded" as const),
      };
    }

    // Poll association briefly when ambiguous — human resolves in inbox UI.
    if (args.waitForAssociation) {
      for (let i = 0; i < 6; i++) {
        const payload: {
          from: string;
          subject: string;
          text: string;
          attachmentName: string;
          attachmentContentBase64: string;
          notifyPhone: string;
          dealId?: Id<"deals">;
          organizationId: Id<"organizations">;
          associationPending: boolean;
        } | null = await step.runQuery(
          internal.povSteps.loadInboundPayload,
          { runId: args.runId },
          { name: `assocCheck_${i}` },
        );
        if (payload && !payload.associationPending && payload.dealId) {
          break;
        }
        if (i < 5) {
          await step.sleep(5_000, { name: `waitAssoc_${i}` });
        }
      }
    }

    const inbound: {
      from: string;
      subject: string;
      text: string;
      attachmentName: string;
      attachmentContentBase64: string;
      notifyPhone: string;
      dealId?: Id<"deals">;
      organizationId: Id<"organizations">;
      associationPending: boolean;
    } | null = await step.runQuery(
      internal.povSteps.loadInboundPayload,
      { runId: args.runId },
      { name: "loadInbound" },
    );
    if (!inbound) {
      await step.runMutation(
        internal.runSteps.markFailed,
        { runId: args.runId, errorMessage: "Missing inbound payload" },
        { name: "failMissingInbound" },
      );
      return { status: "failed" as const };
    }

    const extraction: {
      pages: Array<{
        pageNumber: number;
        text: string;
        sectionLabel?: string;
      }>;
      provider: string;
      mockLabel?: string;
    } = await step.runAction(
      internal.documentActions.extractPdf,
      { contentBase64: inbound.attachmentContentBase64 },
      { name: "extractPdf" },
    );

    const documentId: Id<"documents"> = await step.runMutation(
      internal.povSteps.persistDocumentFromEmail,
      {
        organizationId: args.organizationId,
        runId: args.runId,
        dealId: inbound.dealId,
        title: inbound.attachmentName,
        contentBase64: inbound.attachmentContentBase64,
        pages: extraction.pages,
        extractionProvider: extraction.provider,
        actorAuthUserId: args.principalAuthUserId,
      },
      { name: "persistDocument" },
    );

    const citationSummary = extraction.pages
      .slice(0, 3)
      .map(
        (p: { pageNumber: number; text: string }) =>
          `[p.${p.pageNumber}] ${p.text.slice(0, 160)}`,
      )
      .join("\n");

    const approvalId: Id<"approvals"> = await step.runMutation(
      internal.povSteps.proposeGhlNoteFromDoc,
      {
        organizationId: args.organizationId,
        runId: args.runId,
        dealId: inbound.dealId,
        documentId,
        principalAuthUserId: args.principalAuthUserId,
        citationSummary,
      },
      { name: "proposeGhl" },
    );

    const secureLinkPath = `/approvals?approvalId=${approvalId}`;
    await step.runMutation(
      internal.povSteps.recordSmsDryRun,
      {
        organizationId: args.organizationId,
        runId: args.runId,
        approvalId,
        to: inbound.notifyPhone,
        secureLinkPath,
        actorAuthUserId: args.principalAuthUserId,
      },
      { name: "smsDryRun" },
    );

    await step.runMutation(
      internal.povSteps.completePovRun,
      {
        runId: args.runId,
        summary: [
          "POV dry-run ready for approval.",
          `Document ${documentId} extracted via ${extraction.provider}.`,
          extraction.mockLabel ?? "",
          "GHL note proposed; SMS staff alert recorded as DRY-RUN.",
          "Approve exact payload in Approvals, then dry-run execute.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      { name: "completeWaiting" },
    );

    return { status: "waiting_for_approval" as const };
  },
});
