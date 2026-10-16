import type { EmailProvider, EmailSendResult, ProviderHealth } from "./types";

const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

class MockEmailProvider implements EmailProvider {
  readonly name = "agentmail";
  readonly mode = "mock" as const;

  async send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    fromInboxId?: string;
    idempotencyKey?: string;
  }): Promise<EmailSendResult> {
    console.info("[MOCK EmailProvider] would send", {
      to: input.to,
      subject: input.subject,
      textPreview: input.text.slice(0, 120),
      idempotencyKey: input.idempotencyKey,
    });
    return {
      externalId: `mock-email-${input.idempotencyKey ?? Date.now()}`,
      threadId: `mock-thread-${Date.now()}`,
      status: "mock",
    };
  }

  async ensureInbox(input: { clientId: string; displayName?: string }) {
    return {
      inboxId: `mock-inbox-${input.clientId}`,
      emailAddress: `${input.clientId}@mock.agentmail.test`,
      mode: this.mode,
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
    html?: string;
    fromInboxId?: string;
    idempotencyKey?: string;
  }): Promise<EmailSendResult> {
    console.info("[DRY-RUN EmailProvider] blocked live send", {
      to: input.to,
      subject: input.subject,
      fromInboxId: input.fromInboxId,
    });
    return {
      externalId: `dry-run-email-${input.idempotencyKey ?? Date.now()}`,
      threadId: `dry-run-thread-${Date.now()}`,
      status: "dry-run",
    };
  }

  async ensureInbox(input: { clientId: string; displayName?: string }) {
    return {
      inboxId: `dryrun-inbox-${input.clientId}`,
      emailAddress: `${input.clientId}@dryrun.agentmail.test`,
      mode: this.mode,
    };
  }
}

/**
 * Live AgentMail adapter — only used when ALLOW_LIVE_OUTBOUND=true.
 * API verified: POST /v0/inboxes, POST /v0/inboxes/{inbox_id}/messages/send
 * (docs.agentmail.to).
 */
class AgentMailLiveProvider implements EmailProvider {
  readonly name = "agentmail";
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  async ensureInbox(input: { clientId: string; displayName?: string }) {
    const response = await fetch(`${AGENTMAIL_API_BASE}/inboxes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: input.clientId,
        display_name: input.displayName,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `AgentMail create inbox failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      inbox_id: string;
      email: string;
    };
    return {
      inboxId: body.inbox_id,
      emailAddress: body.email,
      mode: this.mode,
    };
  }

  async send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    fromInboxId?: string;
    idempotencyKey?: string;
  }): Promise<EmailSendResult> {
    if (!input.fromInboxId) {
      throw new Error("AgentMail send requires fromInboxId");
    }
    const response = await fetch(
      `${AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(input.fromInboxId)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(input.idempotencyKey
            ? { "Idempotency-Key": input.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
        }),
      },
    );
    if (!response.ok) {
      // Ambiguous: timeout / 5xx after possible acceptance → unknown
      if (response.status >= 500 || response.status === 408) {
        return {
          externalId: `unknown-email-${input.idempotencyKey ?? Date.now()}`,
          status: "unknown",
        };
      }
      throw new Error(
        `AgentMail send failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      message_id: string;
      thread_id: string;
    };
    return {
      externalId: body.message_id,
      threadId: body.thread_id,
      status: "sent",
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
  return new AgentMailLiveProvider(apiKey);
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
    mode: "live",
    configured: true,
    message: "LIVE AgentMail adapter enabled (ALLOW_LIVE_OUTBOUND=true).",
  };
}
