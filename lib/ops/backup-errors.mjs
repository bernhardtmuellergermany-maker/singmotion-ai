// Only fixed vocabulary may cross a log or private protocol boundary.
const phases = new Set([
  "HIDRIVE_CREATE",
  "HIDRIVE_READBACK",
  "HIDRIVE_GET",
  "PREPARE",
  "INTEGRATION",
  "ARTIFACT_UPLOAD",
  "MANIFEST_UPLOAD",
  "COMMIT",
  "READ",
  "SESSION",
  "LISTEN",
  "RESTORE",
]);
const codes = new Set([
  "HTTP_400",
  "HTTP_401",
  "HTTP_403",
  "HTTP_409",
  "HTTP_411",
  "HTTP_413",
  "HTTP_429",
  "HTTP_500",
  "HTTP_502",
  "HTTP_503",
  "UNKNOWN",
  "TIMEOUT",
  "TLS_HOSTNAME",
  "TLS_CERTIFICATE",
  "TRANSPORT",
  "LOCAL_STREAM",
  "AUTH_REFUSED",
  "NOT_FOUND",
  "CONFLICT",
  "RECEIVER_REJECTED",
  "REMOTE_HTTP",
  "SIZE",
  "INTEGRITY",
  "SPOOL",
  "VALIDATION",
]);
export function failureCode(error) {
  if (codes.has(error?.backupCode)) return error.backupCode;
  const knownMessages = {
    PRIVATE_SPOOL_REQUIRED: "SPOOL",
    ARCHIVE_HASH_MISMATCH: "INTEGRITY",
    ARCHIVE_SIZE_LIMIT: "SIZE",
    HIDRIVE_API_UNREACHABLE: "TRANSPORT",
    INCOMPLETE_REMOTE_ARCHIVE: "VALIDATION",
  };
  if (Object.hasOwn(knownMessages, error?.message ?? ""))
    return knownMessages[error.message];
  const code = error?.code;
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return "TLS_HOSTNAME";
  if (
    [
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED",
    ].includes(code)
  )
    return "TLS_CERTIFICATE";
  if (
    ["ETIMEDOUT", "ABORT_ERR"].includes(code) ||
    error?.name === "TimeoutError"
  )
    return "TIMEOUT";
  return "UNKNOWN";
}
export function backupError(code) {
  const error = Error("BACKUP_OPERATION_FAILED");
  error.backupCode = codes.has(code) ? code : "UNKNOWN";
  return error;
}
export function diagnostic(phase, error) {
  return `BACKUP_${phases.has(phase) ? phase : "PREPARE"}_${failureCode(error)}`;
}
export async function phase(phaseName, operation, report) {
  try {
    return await operation();
  } catch (error) {
    report(diagnostic(phaseName, error));
    throw error;
  }
}
export function refusal(status) {
  return backupError(
    {
      403: "AUTH_REFUSED",
      404: "NOT_FOUND",
      409: "CONFLICT",
      422: "RECEIVER_REJECTED",
    }[status] ?? "REMOTE_HTTP",
  );
}

export function remoteHttp(status) {
  return backupError(
    codes.has(`HTTP_${status}`) ? `HTTP_${status}` : "REMOTE_HTTP",
  );
}
