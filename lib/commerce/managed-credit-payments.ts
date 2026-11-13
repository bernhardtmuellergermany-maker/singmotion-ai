/**
 * Stripe Managed Payments is the merchant of record for its supported
 * digital-good markets. Stripe must explicitly approve the account AND this
 * exact prepaid-credit product: an AIaaS tax code alone is not eligibility.
 * The code never makes an undocumented tax exemption or overrides sanctions.
 */
const RESTRICTED=new Set(["CN","CU","IR","XK","KP","RU","SY","AC","TA"]);
const AI_TAX_CODES=new Set(["txcd_10105001","txcd_10105002","txcd_10105003","txcd_10105004"]);
export function managedCreditMoRApproved(env:Record<string,string|undefined>):boolean{
 return env.CREDIT_GLOBAL_MERCHANT_OF_RECORD==="stripe-managed" &&
  env.STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED==="true" &&
  env.STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED==="true" &&
  env.STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED==="true" &&
  AI_TAX_CODES.has(env.STRIPE_CREDIT_TAX_CODE||"");
}
export function managedCreditBuyerSupported(country:unknown):boolean{
 return typeof country==="string"&&/^[A-Z]{2}$/.test(country)&&
  !RESTRICTED.has(country);
}
export function managedCreditTaxDecision(
 env:Record<string,string|undefined>,country:unknown,buyerType:unknown
){
 if(!managedCreditMoRApproved(env))
  return {ready:false,reason:"MANAGED_PAYMENTS_ELIGIBILITY_UNVERIFIED",decision:null};
 if(!managedCreditBuyerSupported(country))
  return {ready:false,reason:"STRIPE_MANAGED_PAYMENTS_COUNTRY_RESTRICTED",decision:null};
 if(buyerType!=="consumer"&&buyerType!=="business")
  return {ready:false,reason:"CUSTOMER_TYPE_REQUIRED",decision:null};
 return {ready:true,reason:"STRIPE_MERCHANT_OF_RECORD",decision:{
  country:country as string,buyerType,voucherKind:"merchant-of-record-determined" as const,
  mode:"stripe-managed-payments" as const,revision:"stripe-mor-v1",
  taxAtIssue:false,taxCode:env.STRIPE_CREDIT_TAX_CODE!,
 }};
}
