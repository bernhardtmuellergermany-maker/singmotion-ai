/** New customer purchases are Credit top-ups only.
 *
 * Historical Stripe video and Hobby transactions remain in the database for
 * authenticated ownership checks, delivery, portal cancellation and signed
 * refund/dispute reconciliation. Never allow new purchase sessions through
 * the retired endpoints, even if legacy flags are mistakenly left enabled.
 */
export const CUSTOMER_CREDITS_ONLY_COMMERCE=true as const;
export function legacyCustomerPurchaseRetired():boolean{
 return CUSTOMER_CREDITS_ONLY_COMMERCE;
}
export const LEGACY_PURCHASE_RETIRED_RESPONSE={
 error:"This purchase flow is retired. Buy Credits to fund your video generation.",
 code:"CREDITS_ONLY",
 creditsUrl:"/credits#buy-credits",
} as const;
