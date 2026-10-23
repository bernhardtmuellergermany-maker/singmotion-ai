import {
  signBytePlusRequest,
  loadBytePlusCredentials,
  type BytePlusCredentials,
} from "./signing.ts";
import { assertBytePlusVerified } from "./contract.ts";
import { providerRequest } from "./timeout.ts";
import type { Transport } from "./byteplus.ts";

export class BytePlusTransportError extends Error {
  readonly kind: "authentication" | "throttled" | "transient" | "protocol";
  constructor(kind: BytePlusTransportError["kind"]) {
    super(`BytePlus transport ${kind} failure.`);
    this.kind = kind;
  }
}
/** Dependency-injected transport, exercised only with mock HTTP clients. No
 * default global fetch: constructing this does not authorize a paid request.
 * The dedicated first-test CLI wires fetch only behind its one-time spending gate.
 */
export function createSignedTransport(
  http: typeof fetch,
  credentials: () => BytePlusCredentials = loadBytePlusCredentials,
  now: () => Date = () => new Date(),
  timeoutMs = 60_000,
): Transport {
  return async (request, callerSignal) => {
    callerSignal.throwIfAborted();
    try {
      return await providerRequest(async (timeoutSignal) => {
        const signal = AbortSignal.any([callerSignal, timeoutSignal]);
        let signed;
        try {
          signed = signBytePlusRequest(request, credentials(), now());
        } catch {
          throw new BytePlusTransportError("protocol");
        }
        const response = await http(signed.url, {
          method: signed.method,
          headers: signed.headers,
          body: signed.body,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal,
        });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          throw new BytePlusTransportError("authentication");
        }
        if (response.status === 429) {
          await response.body?.cancel();
          throw new BytePlusTransportError("throttled");
        }
        // Limit read size before parsing. Never expose provider messages/URLs.
        if (!response.body) throw new BytePlusTransportError("protocol");
        const reader = response.body.getReader();
        const abortRead = () => {
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener("abort", abortRead, { once: true });
        if (signal.aborted) abortRead();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 1024 * 1024)
              throw new BytePlusTransportError("protocol");
            chunks.push(value);
          }
        } finally {
          signal.removeEventListener("abort", abortRead);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        signal.throwIfAborted();
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new BytePlusTransportError(
            response.status >= 500 ? "transient" : "protocol",
          );
        }
        // Preserve documented business errors (e.g. non-retryable 50510) even
        // on HTTP 500. Unknown 5xx responses remain transient read failures.
        if (
          response.status >= 500 &&
          (!body || typeof body !== "object" || !("code" in body))
        )
          throw new BytePlusTransportError("transient");
        if (response.status !== 200 && response.status < 500)
          throw new BytePlusTransportError("protocol");
        return { status: response.status, body };
      }, timeoutMs);
    } catch (error) {
      if (error instanceof BytePlusTransportError) throw error;
      // Includes timeout/network errors. Submission outcome may be uncertain.
      throw new BytePlusTransportError("transient");
    }
  };
}
/** Production default remains a hard gate; it never loads AK/SK or calls fetch.
 * No environment flag may bypass unresolved input/output/billing verification.
 */
export const liveSignedTransport: Transport = async () =>
  assertBytePlusVerified();
