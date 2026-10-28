/** Only fixed categories and validated HTTP integers may leave this boundary. */
export interface R2Failure {
  category: string;
  httpStatus?: number;
}
export function r2Failure(error: unknown): R2Failure {
  const e = error as {
    name?: unknown;
    code?: unknown;
    cause?: { code?: unknown };
    $metadata?: { httpStatusCode?: unknown };
  } | null;
  const status = e?.$metadata?.httpStatusCode;
  const httpStatus =
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
      ? status
      : undefined;
  const codes = [e?.name, e?.code, e?.cause?.code];
  const has = (...allowed: string[]) =>
    codes.some((code) => typeof code === "string" && allowed.includes(code));
  let category = "unknown";
  if (
    has(
      "InvalidAccessKeyId",
      "SignatureDoesNotMatch",
      "InvalidToken",
      "ExpiredToken",
    )
  )
    category = "authentication";
  else if (has("RequestTimeTooSkewed", "RequestExpired")) category = "clock";
  else if (
    has(
      "NotImplemented",
      "InvalidRequest",
      "InvalidArgument",
      "UnsupportedHeader",
      "UnsupportedOperation",
    )
  )
    category = "request-parameters";
  else if (has("BadDigest", "InvalidDigest")) category = "checksum";
  else if (
    has(
      "TimeoutError",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
    )
  )
    category = "timeout";
  else if (
    has(
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    )
  )
    category = "network";
  else if (has("AbortError")) category = "aborted";
  else if (has("AccessDenied") || httpStatus === 403)
    category = "access-denied";
  else if (httpStatus === 401) category = "authentication";
  else if (httpStatus === 404) category = "bucket-or-object-not-found";
  else if (httpStatus === 412) category = "conditional-write-conflict";
  else if (httpStatus === 429 || has("SlowDown")) category = "throttled";
  else if (httpStatus === 501) category = "request-parameters";
  else if (httpStatus !== undefined && httpStatus >= 500) category = "service";
  else if (httpStatus === 400) category = "bad-request";
  return { category, ...(httpStatus === undefined ? {} : { httpStatus }) };
}
