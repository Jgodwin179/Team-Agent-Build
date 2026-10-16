import { buildMockPdfBytes } from "./providers/boxMock";

/** Base64 helper safe for Convex V8 (no Node Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function mockSellerPdfBase64(): string {
  return bytesToBase64(buildMockPdfBytes("Seller CIM"));
}
