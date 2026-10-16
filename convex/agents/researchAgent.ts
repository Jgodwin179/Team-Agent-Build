import { Agent, mockModel, stepCountIs } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { action, env, internalAction } from "../_generated/server";

export type ModelMode = "mock" | "gateway";

/**
 * Prefer AI Gateway only when explicitly enabled on the Convex deployment.
 * Local anonymous backends stay on the labeled mock model.
 */
export function resolveModelMode(): ModelMode {
  return env.USE_AI_GATEWAY === "true" ? "gateway" : "mock";
}

function buildLanguageModel(mode: ModelMode) {
  if (mode === "gateway") {
    return convexGateway("openai/gpt-4o-mini");
  }
  return mockModel({
    provider: "mock-provider",
    modelId: "mock-assignment-agent",
    content: [
      {
        type: "text",
        text: [
          "[MOCK MODEL] Assignment brief complete.",
          "I used the read-only listOrgDeals tool results provided in context.",
          "No outbound email/SMS/CRM writes were attempted.",
        ].join(" "),
      },
    ],
  });
}

export function createResearchAgent(mode: ModelMode) {
  // Agent + AI SDK produce an excessively deep union under tsc (TS2590).
  // @ts-expect-error TS2590 complex Agent/AI SDK union
  return new Agent(components.agent, {
    name: "assignment-research",
    languageModel: buildLanguageModel(mode),
    instructions: [
      "You are a bounded research specialist for a brokerage team.",
      "Use only the provided listOrgDeals read-only tool output for deal context.",
      "Never claim to send email, SMS, or CRM updates.",
      "If running under the mock model, clearly acknowledge MOCK mode.",
    ].join(" "),
    maxSteps: 4,
    stopWhen: stepCountIs(4),
  });
}

export const generateAssignmentBrief = internalAction({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    toolContextJson: v.string(),
    modelMode: v.union(v.literal("mock"), v.literal("gateway")),
    maxSteps: v.number(),
  },
  returns: v.object({
    text: v.string(),
    modelMode: v.union(v.literal("mock"), v.literal("gateway")),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
  }),
  handler: async (ctx, args): Promise<{
    text: string;
    modelMode: ModelMode;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }> => {
    const agent = createResearchAgent(args.modelMode);
    const { thread } = await agent.continueThread(ctx, {
      threadId: args.threadId,
    });

    const fullPrompt = [
      args.prompt,
      "",
      "Read-only tool result from listOrgDeals (server-executed, idempotent):",
      args.toolContextJson,
    ].join("\n");

    const result = await thread.generateText({
      prompt: fullPrompt,
      stopWhen: stepCountIs(Math.min(args.maxSteps, 4)),
    });

    const usage = result.usage as
      | {
          inputTokens?: number | { total?: number };
          outputTokens?: number | { total?: number };
        }
      | undefined;

    const inputTokens =
      typeof usage?.inputTokens === "number"
        ? usage.inputTokens
        : (usage?.inputTokens?.total ?? 3);
    const outputTokens =
      typeof usage?.outputTokens === "number"
        ? usage.outputTokens
        : (usage?.outputTokens?.total ?? 10);

    return {
      text: result.text,
      modelMode: args.modelMode,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  },
});

export const getModelMode = action({
  args: {},
  returns: v.object({
    modelMode: v.union(v.literal("mock"), v.literal("gateway")),
    label: v.string(),
  }),
  handler: async (): Promise<{ modelMode: ModelMode; label: string }> => {
    const modelMode = resolveModelMode();
    return {
      modelMode,
      label:
        modelMode === "mock"
          ? "MOCK — USE_AI_GATEWAY is not true; agent uses mockModel (no live LLM calls)."
          : "GATEWAY — Convex AI Gateway model selected.",
    };
  },
});
