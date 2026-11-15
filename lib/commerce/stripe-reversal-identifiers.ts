/** Stripe's 2026 Payments API can return pyr_ Refunds and py_ Charges,
 * while older integrations still use re_ and ch_. Never accept arbitrary
 * IDs: every accepted identifier is independently fetched and fully verified
 * using the exact environment-bound Stripe API credential. */
export function validStripeRefundId(value:unknown):value is string{
 return typeof value==="string" && /^(?:re|pyr)_[A-Za-z0-9_]+$/.test(value);
}
export function validStripeChargeId(value:unknown):value is string{
 return typeof value==="string" && /^(?:ch|py)_[A-Za-z0-9_]+$/.test(value);
}
export function validStripeDisputeId(value:unknown):value is string{
 return typeof value==="string" && /^dp_[A-Za-z0-9_]+$/.test(value);
}
