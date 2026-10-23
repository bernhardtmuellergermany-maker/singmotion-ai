/** Wire contract from the supplied OmniHuman 2.0 document, updated 2026-10-15.
 * Transport is injected for mocks. No default fetch, credentials, or guessed signer.
 */
import { type VerifiedContract } from "./contract.ts";
import {
  liveSignedTransport,
  BytePlusTransportError,
} from "./signed-transport.ts";
import type { ReviewedProvider } from "./runner.ts";
import type { PreparedMedia } from "./store.ts";
import { validateOutputUrl } from "./output.ts";

export const omni20 = Object.freeze({
  endpoint: "https://cv.byteplusapi.com/",
  service: "cv",
  region: "ap-singapore-1",
  version: "2024-06-06",
  reqKey: "realman_avatar_picture_omni20_cv",
  outputUrlLifetimeSeconds: 3600,
});
export type Action =
  "CVSync2AsyncSubmitTask" | "CVSync2AsyncGetResult" | "CVCancelTask";
export interface WireRequest {
  url: string;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
}
export function wireRequest(
  action: Action,
  body: Record<string, unknown>,
): WireRequest {
  return {
    url: `${omni20.endpoint}?Action=${action}&Version=${omni20.version}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, req_key: omni20.reqKey }),
  };
}
export type Transport = (
  request: WireRequest,
  signal: AbortSignal,
) => Promise<{ status: number; body: unknown }>;
/** Every actual request remains denied, even if env flags/credentials are present. */
export const blockedTransport: Transport = liveSignedTransport;
export class BytePlusError extends Error {
  readonly retryableRead: boolean;
  constructor(retryableRead = false) {
    super(
      "BytePlus request failed; no automatic submission retry is permitted.",
    );
    this.retryableRead = retryableRead;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BytePlusError();
  return value as Record<string, unknown>;
}
function taskId(id: unknown): string {
  if (typeof id !== "string" || !id.trim() || id.length > 512)
    throw new BytePlusError();
  return id;
}
export type TaskStatus =
  "in_queue" | "generating" | "done" | "not_found" | "expired" | "canceled";
export class BytePlusProtocol {
  readonly transport: Transport;
  constructor(transport: Transport = blockedTransport) {
    this.transport = transport;
  }
  private async call(
    action: Action,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    let result;
    try {
      result = await this.transport(wireRequest(action, body), signal);
    } catch (error) {
      throw new BytePlusError(
        !(error instanceof BytePlusTransportError) ||
          ["transient", "throttled"].includes(error.kind),
      );
    }
    const response = object(result.body);
    // Never inspect data or the misleading outer status before code.
    if (result.status !== 200 || response.code !== 10000) {
      throw new BytePlusError(
        [50429, 50430, 50500, 50501].includes(Number(response.code)),
      );
    }
    return response;
  }
  async submit(
    input: { imageUrl: string; audioUrl: string; prompt?: string },
    signal: AbortSignal,
  ) {
    const result = await this.call(
      "CVSync2AsyncSubmitTask",
      {
        image_urls: [input.imageUrl],
        audio_url: input.audioUrl,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        // Retain the documented watermark default; no undocumented idempotency field.
      },
      signal,
    );
    return { jobId: taskId(object(result.data).task_id) };
  }
  async status(
    id: string,
    signal: AbortSignal,
  ): Promise<{ status: TaskStatus; outputUrl?: string }> {
    const result = await this.call(
      "CVSync2AsyncGetResult",
      { task_id: taskId(id) },
      signal,
    );
    const data = object(result.data);
    const states: readonly unknown[] = [
      "in_queue",
      "generating",
      "done",
      "not_found",
      "expired",
      "canceled",
    ];
    if (!states.includes(data.status)) throw new BytePlusError();
    if (
      data.status === "done" &&
      (typeof data.video_url !== "string" || !data.video_url)
    )
      throw new BytePlusError();
    return {
      status: data.status as TaskStatus,
      ...(data.status === "done"
        ? { outputUrl: data.video_url as string }
        : {}),
    };
  }
  async cancelQueued(id: string, signal: AbortSignal) {
    // Check immediately; provider still arbitrates a race with task consumption.
    if ((await this.status(id, signal)).status !== "in_queue")
      throw new BytePlusError();
    await this.call("CVCancelTask", { task_id: taskId(id) }, signal);
    // No inference of a refund or release of the existing spending reservation.
  }
}
export interface InputLease {
  owner: string;
  audioSha256: string;
  imageSha256: string;
  imageUrl: string;
  audioUrl: string;
  expiresAt: number;
}
/** Must be backed by private object storage with scoped, expiring GET capabilities.
 * No application asset route is exempted from staging/session authentication.
 * Storage provisioning/signing is deliberately not invented from a model API page.
 */
export interface PrivateInputDelivery {
  issue(media: PreparedMedia, signal: AbortSignal): Promise<InputLease>;
}
export class DocumentedBytePlusProvider implements ReviewedProvider {
  readonly contract: VerifiedContract;
  readonly protocol: BytePlusProtocol;
  readonly delivery: PrivateInputDelivery;
  readonly inputHosts: readonly string[];
  constructor(
    contract: VerifiedContract,
    delivery: PrivateInputDelivery,
    inputHosts: readonly string[],
    protocol = new BytePlusProtocol(),
  ) {
    this.contract = contract;
    this.delivery = delivery;
    this.inputHosts = inputHosts;
    this.protocol = protocol;
  }
  async submit(media: PreparedMedia, _requestKey: string, signal: AbortSignal) {
    // Runner has already consumed one-time approval, checked ownership snapshots,
    // hashes, actual media, and reserved the inclusive spending upper bound.
    if (media.durationSeconds < 4 || media.durationSeconds > 300)
      throw new BytePlusError();
    const lease = await this.delivery.issue(media, signal);
    if (
      lease.owner !== media.owner ||
      lease.audioSha256 !== media.audioSha256 ||
      lease.imageSha256 !== media.imageSha256 ||
      !Number.isSafeInteger(lease.expiresAt) ||
      lease.expiresAt <= Date.now()
    )
      throw new BytePlusError();
    validateOutputUrl(lease.imageUrl, this.inputHosts);
    validateOutputUrl(lease.audioUrl, this.inputHosts);
    return this.protocol.submit(
      {
        imageUrl: lease.imageUrl,
        audioUrl: lease.audioUrl,
        prompt: media.prompt,
      },
      signal,
    );
  }
  async poll(id: string, signal: AbortSignal) {
    try {
      const result = await this.protocol.status(id, signal);
      switch (result.status) {
        case "in_queue":
        case "generating":
          return { state: "pending" as const };
        case "done":
          return { state: "completed" as const, outputUrl: result.outputUrl };
        default:
          return { state: "failed" as const };
      }
    } catch (error) {
      if (error instanceof BytePlusError && !error.retryableRead)
        return { state: "failed" as const };
      throw error; // Read-only retries retain the persisted task ID; never resubmit.
    }
  }
}
