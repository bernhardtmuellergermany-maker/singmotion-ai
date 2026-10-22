export interface GenerationInput {
  audioUrl: string;
  imageUrl: string;
  prompt: string;
  idempotencyKey: string;
}
export interface ProviderJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  outputUrl?: string;
}
export interface VideoProvider {
  name: string;
  create(input: GenerationInput): Promise<ProviderJob>;
  poll(id: string): Promise<ProviderJob>;
}
export class DisabledBytePlusAdapter implements VideoProvider {
  name = "BytePlus OmniHuman 2.0 (disabled)";
  async create(): Promise<ProviderJob> {
    throw new Error(
      "Direct OmniHuman 2.0 API contract is not verified. Live requests are disabled.",
    );
  }
  async poll(): Promise<ProviderJob> {
    throw new Error("BytePlus polling contract is not verified.");
  }
}
export class DisabledFalAdapter extends DisabledBytePlusAdapter {
  name = "fal.ai OmniHuman 2.0 (disabled; no automatic fallback)";
}
export function liveProvider(): never {
  throw new Error("Paid providers cannot be activated in v0.1.");
}
