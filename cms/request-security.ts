// Fixed, non-sensitive diagnostics. Never include request URLs, headers or bodies.
export type CmsDiagnostic =
  | "CMS_ORIGIN_MISSING"
  | "CMS_ORIGIN_REJECTED"
  | "CMS_AUTH_REJECTED"
  | "CMS_ACCESS_DENIED"
  | "CMS_RATE_LIMITED";
export function cmsOriginFailure(
  method: string,
  headers: Headers,
  configuredOrigin: string | undefined,
): CmsDiagnostic | null {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  const origin = headers.get("origin");
  if (!origin) return "CMS_ORIGIN_MISSING";
  // Fail closed. Host, Forwarded and Referer must never authorize a mutation.
  return configuredOrigin && origin === configuredOrigin
    ? null
    : "CMS_ORIGIN_REJECTED";
}
export function cmsLoginDiagnostic(status: number): CmsDiagnostic | null {
  if (status === 401) return "CMS_AUTH_REJECTED";
  if (status === 403) return "CMS_ACCESS_DENIED";
  if (status === 429) return "CMS_RATE_LIMITED";
  return null;
}
export function annotateCmsFailure(response: Response, code: CmsDiagnostic) {
  response.headers.set("X-SingMotion-CMS-Code", code);
  response.headers.set("Cache-Control", "private, no-store");
  // Only fixed enum values and numeric status; never log credentials or user identity.
  console.warn(
    JSON.stringify({
      event: "cms_request_rejected",
      code,
      status: response.status,
    }),
  );
  return response;
}
