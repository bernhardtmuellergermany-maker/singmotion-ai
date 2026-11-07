/** Operator-relayed BytePlus Support: inputs must cover the 12-hour task lifetime.
 * Margins below are application policy, not vendor guarantees or retry promises.
 */
export const inputDeliveryPolicy = Object.freeze({
  taskLifetimeSeconds: 12 * 60 * 60,
  minimumRemainingSeconds: 12 * 60 * 60 + 15 * 60,
  leaseSeconds: 13 * 60 * 60,
  cleanupGraceSeconds: 60 * 60,
});
export function assertInputLifetime(
  expiresAt: number,
  requiredSeconds = inputDeliveryPolicy.minimumRemainingSeconds,
) {
  if (
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(requiredSeconds) ||
    requiredSeconds <= 0 ||
    expiresAt - Date.now() <
      Math.max(requiredSeconds, inputDeliveryPolicy.minimumRemainingSeconds) *
        1000
  )
    throw new Error(
      "Private inputs do not cover the task lifetime and safety margin.",
    );
}
