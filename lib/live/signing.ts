// Server-only Node crypto. No credentials or signing material are logged.
import { createHash, createHmac } from "node:crypto";
import type { WireRequest } from "./byteplus.ts";
export interface BytePlusCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}
export function loadBytePlusCredentials(
  env: Record<string, string | undefined> = process.env,
): BytePlusCredentials {
  if (typeof window !== "undefined")
    throw new Error("BytePlus credentials are server-only.");
  const accessKeyId = env.BYTEPLUS_ACCESS_KEY_ID;
  const secretAccessKey = env.BYTEPLUS_SECRET_ACCESS_KEY;
  if (
    !accessKeyId ||
    !/^[A-Za-z0-9_-]+$/.test(accessKeyId) ||
    !secretAccessKey ||
    /[\r\n]/.test(secretAccessKey)
  )
    throw new Error("BytePlus server credentials are missing or invalid.");
  return { accessKeyId, secretAccessKey };
}
const sha256 = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: string | Buffer, s: string) =>
  createHmac("sha256", key).update(s, "utf8").digest();
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
// Narrow supported surface: only the documented CV JSON POST APIs, no arbitrary
// destinations/paths/headers, duplicate query fields, redirects or session tokens.
export function signBytePlusRequest(
  request: WireRequest,
  credentials: BytePlusCredentials,
  now = new Date(),
): WireRequest {
  const url = new URL(request.url);
  const params = [...url.searchParams];
  if (
    url.origin !== "https://cv.byteplusapi.com" ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.hash ||
    request.method !== "POST" ||
    params.length !== 2 ||
    url.searchParams.getAll("Action").length !== 1 ||
    url.searchParams.getAll("Version").length !== 1 ||
    ![
      "CVSync2AsyncSubmitTask",
      "CVSync2AsyncGetResult",
      "CVCancelTask",
    ].includes(url.searchParams.get("Action")!) ||
    url.searchParams.get("Version") !== "2024-06-06" ||
    Object.keys(request.headers).length !== 1 ||
    request.headers["Content-Type"] !== "application/json" ||
    !Number.isFinite(now.getTime()) ||
    now.getUTCFullYear() < 2000 ||
    now.getUTCFullYear() > 9999
  )
    throw new Error("Unsupported BytePlus signing request.");
  const checked = loadBytePlusCredentials({
    BYTEPLUS_ACCESS_KEY_ID: credentials.accessKeyId,
    BYTEPLUS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  });
  const date = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const scope = `${date.slice(0, 8)}/ap-singapore-1/cv/request`;
  const payloadHash = sha256(request.body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "cv.byteplusapi.com",
    "x-content-sha256": payloadHash,
    "x-date": date,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalQuery = params
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join("&");
  const canonical = [
    "POST",
    "/",
    canonicalQuery,
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = ["HMAC-SHA256", date, scope, sha256(canonical)].join(
    "\n",
  );
  // BytePlus starts with the raw SK, NOT an AWS4-prefixed secret.
  const key = hmac(
    hmac(
      hmac(hmac(checked.secretAccessKey, date.slice(0, 8)), "ap-singapore-1"),
      "cv",
    ),
    "request",
  );
  headers.authorization = `HMAC-SHA256 Credential=${checked.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(key, stringToSign).toString("hex")}`;
  return {
    url: `${url.origin}/?${canonicalQuery}`,
    method: "POST",
    headers,
    body: request.body,
  };
}
