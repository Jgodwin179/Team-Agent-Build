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

export interface EmailProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    idempotencyKey?: string;
  }): Promise<{ externalId: string; status: "sent" | "dry-run" | "mock" }>;
}

export interface SmsProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  send(input: {
    to: string;
    body: string;
    idempotencyKey?: string;
  }): Promise<{ externalId: string; status: "sent" | "dry-run" | "mock" }>;
}
