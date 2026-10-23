import { loadR2Config, r2ClientConfig, type R2Config } from "./r2-config.ts";
export { loadR2Config, r2ClientConfig, type R2Config } from "./r2-config.ts";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { InputLease, PrivateInputDelivery } from "./byteplus.ts";
import { LiveTestStore, type PreparedMedia } from "./store.ts";
import { revalidateMedia } from "./media.ts";
import { providerRequest } from "./timeout.ts";

const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
async function immutableBytes(
  filename: string,
  root: string,
  hash: string,
  limit: number,
) {
  const resolved = await realpath(filename);
  if (
    !resolved.startsWith((await realpath(path.join(root, "media"))) + path.sep)
  )
    throw new Error("Invalid private snapshot path.");
  const handle = await open(
    resolved,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size >= limit)
      throw new Error("Invalid private snapshot size.");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!result.bytesRead) throw new Error("Snapshot changed.");
      offset += result.bytesRead;
    }
    if (digest(bytes) !== hash) throw new Error("Snapshot changed.");
    return bytes; // Upload this validated buffer, never reopen a mutable path.
  } finally {
    await handle.close();
  }
}

/** Explicit construction only; never imported by the demo worker/web routes.
 * One consumed durable approval permits exactly one pair of private uploads.
 */
export class R2PrivateInputDelivery implements PrivateInputDelivery {
  readonly client: S3Client;
  readonly inputHosts: readonly string[];
  private readonly config: R2Config;
  private readonly store: LiveTestStore;
  private readonly root: string;
  private readonly ttl: number;
  constructor(
    store: LiveTestStore,
    dataDir: string,
    config = loadR2Config(),
    client?: S3Client,
    ttlSeconds = 3600,
  ) {
    // Revalidate even programmatically supplied config; no endpoint override.
    this.config = loadR2Config({
      R2_ACCOUNT_ID: config.accountId,
      R2_BUCKET: config.bucket,
      R2_ACCESS_KEY_ID: config.accessKeyId,
      R2_SECRET_ACCESS_KEY: config.secretAccessKey,
    });
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600)
      throw new Error("R2 URL lifetime must be 60–3600 seconds.");
    this.store = store;
    this.root = path.resolve(dataDir);
    this.ttl = ttlSeconds;
    this.client = client ?? new S3Client(r2ClientConfig(this.config));
    this.inputHosts = [`${this.config.accountId}.r2.cloudflarestorage.com`];
  }
  async issue(
    media: PreparedMedia,
    callerSignal: AbortSignal,
  ): Promise<InputLease> {
    let claimed: string | undefined;
    try {
      callerSignal.throwIfAborted();
      const attemptId = this.store.assertInputDeliveryAllowed(media);
      await revalidateMedia(media);
      const audio = await immutableBytes(
        media.audioPath,
        this.root,
        media.audioSha256,
        15_000_000,
      );
      const image = await immutableBytes(
        media.imagePath,
        this.root,
        media.imageSha256,
        30_000_000,
      );
      const format = (await sharp(image).metadata()).format;
      if (format !== "jpeg" && format !== "png")
        throw new Error("Unsupported reference snapshot.");
      const prefix = `byteplus-inputs/v1/${digest(media.owner)}/${attemptId}/${randomUUID()}`;
      const audioKey = `${prefix}/${media.audioSha256}.mp3`;
      const imageKey = `${prefix}/${media.imageSha256}.${format === "jpeg" ? "jpg" : "png"}`;
      const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000);
      const expiresAt = signingDate.getTime() + this.ttl * 1000;
      callerSignal.throwIfAborted();
      claimed = this.store.claimInputDelivery(media, {
        bucket: this.config.bucket,
        audioKey,
        imageKey,
        expiresAt,
      });
      return await providerRequest(async (timeoutSignal) => {
        const signal = AbortSignal.any([callerSignal, timeoutSignal]);
        const put = async (Key: string, Body: Buffer, ContentType: string) => {
          signal.throwIfAborted();
          await this.client.send(
            new PutObjectCommand({
              Bucket: this.config.bucket,
              Key,
              Body,
              ContentLength: Body.length,
              ContentType,
              ContentMD5: createHash("md5").update(Body).digest("base64"),
              CacheControl: "private, no-store",
              IfNoneMatch: "*",
              // R2 does not support object ACLs. Never send public-read or change bucket policy.
            }),
            { abortSignal: signal },
          );
          signal.throwIfAborted();
        };
        await put(audioKey, audio, "audio/mpeg");
        await put(imageKey, image, `image/${format}`);
        const sign = (Key: string) =>
          getSignedUrl(
            this.client,
            new GetObjectCommand({ Bucket: this.config.bucket, Key }),
            { expiresIn: this.ttl, signingDate },
          );
        const audioUrl = await sign(audioKey);
        const imageUrl = await sign(imageKey);
        signal.throwIfAborted();
        if (expiresAt <= Date.now())
          throw new Error("Input lease expired before delivery.");
        // Guard SDK/client misconfiguration without returning URLs for another host/object.
        for (const [raw, key] of [
          [audioUrl, audioKey],
          [imageUrl, imageKey],
        ]) {
          const url = new URL(raw);
          if (
            url.origin !== `https://${this.inputHosts[0]}` ||
            decodeURIComponent(url.pathname) !==
              `/${this.config.bucket}/${key}` ||
            url.searchParams.get("X-Amz-Expires") !== String(this.ttl) ||
            !url.searchParams.has("X-Amz-Signature")
          )
            throw new Error("Invalid private input lease.");
        }
        this.store.finishInputDelivery(claimed!, "ready");
        return {
          owner: media.owner,
          audioSha256: media.audioSha256,
          imageSha256: media.imageSha256,
          audioUrl,
          imageUrl,
          expiresAt,
        };
      });
    } catch {
      if (claimed) this.store.finishInputDelivery(claimed, "failed");
      // Preserve only private object keys in the ledger for later reconciliation.
      // Partial/ambiguous uploads are never replayed, exposed or blindly deleted.
      throw new Error(
        "Private R2 input delivery failed; review the durable delivery record before retrying.",
      );
    }
  }
  close() {
    this.client.destroy();
  }
}
