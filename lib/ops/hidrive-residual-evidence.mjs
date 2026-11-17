/** Validate Railway log evidence without trusting log delivery order.
 * This function never contacts Railway or HiDrive, and fails closed.
 */
const PREFIX = "HIDRIVE_RESIDUAL_RESULT ";
const COMPLETE = "HIDRIVE_RESIDUAL_CHECK_COMPLETED";
const SHA256 = /^[0-9a-f]{64}$/;
export function parseResidualEvidence(messages) {
  if (!Array.isArray(messages) || !messages.includes(COMPLETE))
    throw Error("RESIDUAL_CHECK_MISSING");
  const records = messages.filter(
    (message) => typeof message === "string" && message.startsWith(PREFIX),
  );
  if (records.length !== 3) throw Error("RESIDUAL_EVIDENCE_INVALID");
  let results;
  try {
    results = records.map((message) => JSON.parse(message.slice(PREFIX.length)));
  } catch {
    throw Error("RESIDUAL_EVIDENCE_INVALID");
  }
  if (results.some((item) => !item || typeof item !== "object" || Array.isArray(item)))
    throw Error("RESIDUAL_EVIDENCE_INVALID");
  results.sort((a, b) => a.ordinal - b.ordinal);
  for (const [index, result] of results.entries()) {
    const ordinal = index + 1;
    if (
      !result ||
      Array.isArray(result) ||
      result.ordinal !== ordinal ||
      !["absent", "present"].includes(result.state)
    )
      throw Error("RESIDUAL_EVIDENCE_INVALID");
    if (result.state === "present") {
      const limit = ordinal === 3 ? 16384 : 1048576;
      if (
        !Number.isSafeInteger(result.bytes) ||
        result.bytes < 0 ||
        result.bytes > limit ||
        typeof result.sha256 !== "string" ||
        !SHA256.test(result.sha256)
      )
        throw Error("RESIDUAL_EVIDENCE_INVALID");
    } else if (
      Object.hasOwn(result, "bytes") ||
      Object.hasOwn(result, "sha256")
    )
      throw Error("RESIDUAL_EVIDENCE_INVALID");
  }
  return results;
}
