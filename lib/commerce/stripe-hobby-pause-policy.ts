/**
 * A paused Hobby checkout must still revoke expired/canceled entitlements
 * for an existing Stripe subscription. Never create a new entitlement while
 * checkout is disabled, and never overwrite another subscription's binding.
 * The caller first verifies Stripe's signed webhook, fetches current Stripe
 * subscription state, and checks the verified account + price.
 */
export type PausedHobbyAction="reconcile"|"ignore"|"retry";
export function pausedHobbyWebhookAction(
 settlementEnabled:boolean,
 verifiedStatus:"active"|"inactive",
 priorSubscriptionId:string|null|undefined,
 verifiedSubscriptionId:string,
):PausedHobbyAction {
 if(!/^sub_[A-Za-z0-9_]+$/.test(verifiedSubscriptionId))return "ignore";
 if(settlementEnabled)return "reconcile";
 if(verifiedStatus==="active")return "retry";
 // Only revoke an existing exact Stripe binding; do not create a record
 // for a customer who has no previous paid subscription in the ledger.
 return priorSubscriptionId===verifiedSubscriptionId?"reconcile":"ignore";
}
