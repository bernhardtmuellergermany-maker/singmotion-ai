/** Public ECB reference only. Never a settlement-rate or fee guarantee. */
export const ecbReferenceUrl =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export class FxReferenceError extends Error {}
export function parseFxReference(xml: string, now = Date.now()) {
  if (xml.length > 65536 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new FxReferenceError("ECB reference format rejected.");
  const dates = [
    ...xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/g),
  ];
  const rates = [
    ...xml.matchAll(
      /<Cube\s+currency=['"]USD['"]\s+rate=['"](\d{1,4}(?:\.\d{1,8})?)['"]\s*\/>/g,
    ),
  ];
  if (dates.length !== 1 || rates.length !== 1)
    throw new FxReferenceError(
      "ECB reference must contain one dated USD rate.",
    );
  const asOf = dates[0][1],
    stamp = Date.parse(asOf + "T00:00:00Z");
  if (
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== asOf ||
    stamp > now ||
    now - stamp > 4 * 86400000
  )
    throw new FxReferenceError(
      "ECB reference is stale, future-dated or invalid; no rate was assumed.",
    );
  const usdPerEur = rates[0][1];
  const [whole, fraction = ""] = usdPerEur.split(".");
  const scale = 10n ** BigInt(fraction.length),
    usd = BigInt(whole + fraction);
  if (usd <= 0n) throw new FxReferenceError("ECB reference rate is invalid.");
  const eurPerUsdPpm = Number((1000000n * scale + usd - 1n) / usd);
  return {
    source: ecbReferenceUrl,
    asOf,
    usdPerEur,
    eurPerUsdPpm,
    referenceOnly: true as const,
  };
}
export async function fetchFxReference(
  http: typeof fetch = fetch,
  now = Date.now(),
) {
  let response: Response;
  try {
    response = await http(ecbReferenceUrl, {
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new FxReferenceError(
      "ECB reference unavailable (network/timeout). No fallback rate or fee was assumed.",
    );
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new FxReferenceError(
      `ECB reference unavailable (HTTP ${response.status}). No fallback rate or fee was assumed.`,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 65536)
        throw new FxReferenceError(
          "ECB response exceeds the reference-size limit.",
        );
      chunks.push(part.value);
    }
    return parseFxReference(Buffer.concat(chunks).toString("utf8"), now);
  } catch (error) {
    if (error instanceof FxReferenceError) throw error;
    throw new FxReferenceError(
      "ECB reference could not be read; no rate was assumed.",
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const planningAcknowledgment =
  "ACCEPT_FX_PLANNING_ASSUMPTIONS_NOT_A_FEE_GUARANTEE";
export function planningReview(
  reference: ReturnType<typeof parseFxReference>,
  acknowledgment: unknown,
  now = Date.now(),
) {
  if (acknowledgment !== planningAcknowledgment)
    throw new FxReferenceError(
      "Explicit acceptance of planning assumptions is required.",
    );
  return {
    budgetBasis: "planning-allowance" as const,
    eurPerUsdUpperPpm: reference.eurPerUsdPpm * 2,
    fxFeesMaxMicroEur: 10000000,
    evidence: `Operator-approved planning assumptions, NOT verified settlement bounds: ECB ${reference.source}, date ${reference.asOf}, EUR 1 = USD ${reference.usdPerEur}; rounded-up reciprocal doubled and EUR 10 conversion/payment-fee reserve. Actual taxes/fees and first-task billing remain unknown. Application limits do not guarantee the provider or bank invoice. Existing provider-cost review remains separately required.`,
    validUntil: new Date(
      Math.min(
        now + 86400000,
        Date.parse(reference.asOf + "T00:00:00Z") + 4 * 86400000,
      ),
    ).toISOString(),
    acknowledgment: "AUTHORIZE_SECOND_WITH_FULL_FIRST_RESERVATION",
  };
}
