import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes, createHash } from "node:crypto";
import { loadR2Config, r2ClientConfig } from "./r2-config.ts";
import { providerRequest } from "./timeout.ts";

export interface CheckResult {
  ok: boolean;
  stage: "configuration" | "upload" | "readback" | "presigned-get" | "complete";
  cleanup: "not-needed" | "deleted" | "failed" | "upload-uncertain";
  // This random, non-sensitive test key is safe to print for manual reconciliation.
  testKey?: string;
  diagnostic: string;
}
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
/** Explicit call only. Each operation is bounded; cleanup gets a fresh timeout. */
export async function checkR2Connectivity(
  env: Record<string, string | undefined>,
  dependencies: {
    client?: S3Client;
    http?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
    reportKey?: (key: string) => void;
  } = {},
): Promise<CheckResult> {
  let config;
  try {
    config = loadR2Config(env);
    if (config.bucket !== "singmotion-ai-private") throw new Error();
  } catch {
    return {
      ok: false,
      stage: "configuration",
      cleanup: "not-needed",
      diagnostic:
        "Set valid server-side R2 variables and R2_BUCKET=singmotion-ai-private.",
    };
  }
  const client = dependencies.client ?? new S3Client(r2ClientConfig(config));
  const http = dependencies.http ?? fetch;
  const timeout = dependencies.timeoutMs ?? 15000;
  const key = `connectivity-tests/${randomBytes(32).toString("hex")}.txt`;
  const body = Buffer.from(
    `SingMotion non-sensitive connectivity probe\n${randomBytes(32).toString("hex")}\n`,
  );
  const expected = sha256(body);
  let created = false;
  const result: CheckResult = {
    ok: false,
    stage: "upload",
    cleanup: "not-needed",
    testKey: key,
    diagnostic: "",
  };
  const requestSignal = (timeoutSignal: AbortSignal) =>
    dependencies.signal
      ? AbortSignal.any([dependencies.signal, timeoutSignal])
      : timeoutSignal;
  try {
    dependencies.signal?.throwIfAborted();
    dependencies.reportKey?.(key);
    try {
      await providerRequest(
        (signal) =>
          client.send(
            new PutObjectCommand({
              Bucket: config.bucket,
              Key: key,
              Body: body,
              ContentType: "text/plain; charset=utf-8",
              ContentLength: body.length,
              ContentMD5: createHash("md5").update(body).digest("base64"),
              CacheControl: "private, no-store",
              IfNoneMatch: "*",
            }),
            { abortSignal: requestSignal(signal) },
          ),
        timeout,
      );
      created = true;
    } catch (error) {
      // A conditional-write conflict proves we did not create that object.
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      result.cleanup =
        status === 412 || status === 401 || status === 403 || status === 404
          ? "not-needed"
          : "upload-uncertain";
      throw error;
    }
    result.stage = "readback";
    await providerRequest(async (signal) => {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: requestSignal(signal) },
      );
      if (!response.Body) throw new Error();
      const stream = response.Body.transformToWebStream();
      const bytes = await boundedRead(stream, requestSignal(signal));
      if (sha256(bytes) !== expected) throw new Error();
    }, timeout);
    result.stage = "presigned-get";
    await providerRequest(async (signal) => {
      const signed = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { expiresIn: 60 },
      );
      const url = new URL(signed);
      if (
        url.origin !== `https://${config.accountId}.r2.cloudflarestorage.com` ||
        decodeURIComponent(url.pathname) !== `/${config.bucket}/${key}` ||
        url.searchParams.get("X-Amz-Expires") !== "60" ||
        !url.searchParams.has("X-Amz-Signature")
      )
        throw new Error();
      const response = await http(signed, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: requestSignal(signal),
      });
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new Error();
      }
      if (
        sha256(await boundedRead(response.body, requestSignal(signal))) !==
        expected
      )
        throw new Error();
    }, timeout);
    result.stage = "complete";
    result.ok = true;
    result.diagnostic =
      "Bucket object read/write access and temporary signed GET verified; both SHA-256 checks matched.";
  } catch {
    result.diagnostic = {
      configuration: "Invalid R2 configuration.",
      upload:
        "Upload failed. Check bucket name, scoped Object Read & Write permissions, endpoint and connectivity.",
      readback:
        "Authenticated readback failed or SHA-256 did not match. Check read permissions and connectivity.",
      "presigned-get":
        "Temporary signed GET failed or SHA-256 did not match. Check credentials, local clock and connectivity.",
      complete: "Check failed.",
    }[result.stage];
  } finally {
    if (created) {
      try {
        await providerRequest(
          (signal) =>
            client.send(
              new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
              { abortSignal: signal },
            ),
          timeout,
        );
        result.cleanup = "deleted";
      } catch {
        result.ok = false;
        result.cleanup = "failed";
        result.diagnostic +=
          " Cleanup could not be confirmed. Reconcile only the reported connectivity-tests object manually.";
      }
    } else if (result.cleanup === "upload-uncertain") {
      result.diagnostic +=
        " Upload outcome is uncertain; no deletion was attempted. Reconcile only the reported test key manually.";
    }
    if (!dependencies.client) client.destroy();
  }
  return result;
}
async function boundedRead(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Buffer> {
  const reader = stream.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 1024) throw new Error("Probe response too large.");
      chunks.push(value);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
