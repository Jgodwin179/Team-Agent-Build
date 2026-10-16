/**
 * Provider interfaces used across Vercel and Convex runtimes.
 * Implementations live in adapter modules; mocks are clearly labeled.
 */

export type ProviderMode = "live" | "mock" | "dry-run";

export interface ProviderHealth {
  provider: string;
  mode: ProviderMode;
  configured: boolean;
  message: string;
}

export interface EmailSendResult {
  externalId: string;
  threadId?: string;
  status: "sent" | "dry-run" | "mock" | "unknown";
}

export interface EmailProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    fromInboxId?: string;
    idempotencyKey?: string;
  }): Promise<EmailSendResult>;
  /**
   * Provision or ensure one agent inbox. Live AgentMail uses POST /v0/inboxes
   * with optional client_id for idempotent retries (docs.agentmail.to).
   */
  ensureInbox?(input: {
    clientId: string;
    displayName?: string;
  }): Promise<{ inboxId: string; emailAddress: string; mode: ProviderMode }>;
}

export interface SmsSendResult {
  externalId: string;
  status: "sent" | "dry-run" | "mock" | "unknown" | "suppressed";
}

export interface SmsProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  send(input: {
    to: string;
    body: string;
    idempotencyKey?: string;
  }): Promise<SmsSendResult>;
}
