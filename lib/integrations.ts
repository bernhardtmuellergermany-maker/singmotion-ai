/** Contracts only. Implementations must be authorized and validated before activation. */
export interface VerifiedIdentity {
  userId: string;
  role: "customer" | "admin";
  assurance: "aal1" | "aal2";
}
export interface AuthGateway {
  verifySession(cookie: string): Promise<VerifiedIdentity | null>;
}
export interface PrivateObjectStore {
  createUpload(input: {
    userId: string;
    assetId: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; key: string }>;
  createDownload(input: {
    userId: string;
    assetId: string;
    expiresInSeconds: number;
  }): Promise<string>;
  copyProviderOutput(input: {
    jobId: string;
    userId: string;
    verifiedProviderUrl: string;
  }): Promise<string>;
  remove(key: string): Promise<void>;
}
export interface PaymentGateway {
  createCheckout(input: {
    userId: string;
    offerId: string;
    idempotencyKey: string;
  }): Promise<{ url: string }>;
  verifyWebhook(
    rawBody: Uint8Array,
    signature: string,
  ): Promise<{ eventId: string; kind: string; purchaseId: string }>;
}
export class DisabledPayments implements PaymentGateway {
  async createCheckout(): Promise<{ url: string }> {
    throw new Error("Stripe charges are disabled in v0.1.");
  }
  async verifyWebhook(): Promise<{
    eventId: string;
    kind: string;
    purchaseId: string;
  }> {
    throw new Error("Stripe webhook processing is not connected.");
  }
}
export function requireAdmin(identity: VerifiedIdentity | null) {
  if (!identity || identity.role !== "admin" || identity.assurance !== "aal2")
    throw new Error("Administrator MFA is required.");
  return identity;
}
