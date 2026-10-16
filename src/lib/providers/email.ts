import type { EmailProvider, ProviderHealth } from "./types";

class MockEmailProvider implements EmailProvider {
  readonly name = "agentmail";
  readonly mode = "mock" as const;

  async send(input: {
    to: string;
    subject: string;
    text: string;
  }) {
    console.info("[MOCK EmailProvider] would send", {
      to: input.to,
      subject: input.subject,
      textPreview: input.text.slice(0, 120),
    });
    return {
      externalId: `mock-email-${Date.now()}`,
      status: "mock" as const,
    };
  }
}

class DryRunEmailProvider implements EmailProvider {
  readonly name = "agentmail";
  readonly mode = "dry-run" as const;

  async send(input: {
    to: string;
    subject: string;
    text: string;
  }) {
    console.info("[DRY-RUN EmailProvider] blocked live send", {
      to: input.to,
      subject: input.subject,
    });
    return {
      externalId: `dry-run-email-${Date.now()}`,
      status: "dry-run" as const,
    };
  }
}

export function getEmailProvider(): EmailProvider {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  const allowLive = process.env.ALLOW_LIVE_OUTBOUND === "true";
  if (!apiKey) {
    return new MockEmailProvider();
  }
  if (!allowLive) {
    return new DryRunEmailProvider();
  }
  // Live AgentMail adapter lands in Phase 4. Until then, refuse to pretend.
  return new DryRunEmailProvider();
}

export function getEmailProviderHealth(): ProviderHealth {
  const configured = Boolean(process.env.AGENTMAIL_API_KEY);
  const allowLive = process.env.ALLOW_LIVE_OUTBOUND === "true";
  if (!configured) {
    return {
      provider: "agentmail",
      mode: "mock",
      configured: false,
      message: "MOCK — AGENTMAIL_API_KEY missing; no live email will be sent.",
    };
  }
  if (!allowLive) {
    return {
      provider: "agentmail",
      mode: "dry-run",
      configured: true,
      message:
        "DRY-RUN — credentials present but ALLOW_LIVE_OUTBOUND is not true.",
    };
  }
  return {
    provider: "agentmail",
    mode: "dry-run",
    configured: true,
    message:
      "DRY-RUN — live AgentMail adapter not implemented until Phase 4.",
  };
}
