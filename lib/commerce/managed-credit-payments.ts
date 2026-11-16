/**
 * Stripe Managed Payments is the merchant of record for its supported
 * digital-good markets. Stripe must explicitly approve the account AND this
 * exact prepaid-credit product: an AIaaS tax code alone is not eligibility.
 * The code never makes an undocumented tax exemption or overrides sanctions.
 */
const RESTRICTED=new Set(["CN","CU","IR","XK","KP","RU","SY","AC","TA"]);
const AI_TAX_CODES=new Set(["txcd_10105001","txcd_10105002","txcd_10105003","txcd_10105004"]);
// Stripe Managed Payments tax coverage for a German seller's CROSS-BORDER
// digital sales, according to Stripe's published tax-compliance jurisdiction
// table on 2026-11-16. Merchant-of-record buyer eligibility (195+ markets)
// is NOT identical to the markets in which Stripe assumes indirect tax
// compliance. Do not imply Stripe files/remits taxes elsewhere.
// https://docs.stripe.com/payments/managed-payments/tax-compliance#cross-border-sales
// RS excluded until seller's Serbia VAT-registration exception is reviewed.
const STRIPE_MANAGED_TAX_COVERED_COUNTRIES=new Set(
 ("CM EG GH KE NG UG ZA ZM ZW "+
 "AM AU AZ BN GE HK ID IL IN JP KG KR KW KZ LA MO MY NP NZ PH QA SA SG TH TJ TR TW VN "+
 "AL BY CH GB GI IS LI MD NO UA "+
 "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK "+
 "BB BM KY MX VG CA US").split(" ")
);
export function managedCreditMoRTaxCovered(country:unknown):boolean {
 return managedCreditBuyerSupported(country) &&
  STRIPE_MANAGED_TAX_COVERED_COUNTRIES.has(country as string);
}

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
 if(!managedCreditMoRTaxCovered(country))
  return {ready:false,reason:"STRIPE_MANAGED_PAYMENTS_TAX_COVERAGE_NOT_AVAILABLE",decision:null};
 return {ready:true,reason:"STRIPE_MERCHANT_OF_RECORD",decision:{
  country:country as string,buyerType:buyerType as "consumer"|"business",voucherKind:"merchant-of-record-determined" as const,
  mode:"stripe-managed-payments" as const,revision:"stripe-mor-v1",
  taxAtIssue:false,taxCode:env.STRIPE_CREDIT_TAX_CODE!,
 }};
}

/** Managed Payments owns invoicing, tax and dynamic payment method selection.
 * Before any Stripe POST, fail closed if an incompatible parameter slipped into
 * the request. Stripe docs: /payments/managed-payments/update-checkout.
 * This never enables Merchant-of-Record mode by itself.
 */
export function assertManagedCreditCheckoutParams(form:URLSearchParams):void{
 const forbidden=[
  /^invoice_creation(?:\[|$)/,
  /^automatic_tax(?:\[|$)/,
  /^tax_id_collection(?:\[|$)/,
  /^adaptive_pricing(?:\[|$)/,
  /^payment_method_types(?:\[|$)/,
  /^excluded_payment_method_types(?:\[|$)/,
  /^payment_method_configuration(?:\[|$)/,
  /^customer_update(?:\[|$)/,
  /^shipping_(?:address_collection|options)(?:\[|$)/,
  /^payment_intent_data\[(?:application_fee_amount|on_behalf_of|transfer_data|transfer_group|shipping|statement_descriptor|statement_descriptor_suffix|receipt_email)\]/,
 ];
 if(form.get("managed_payments[enabled]")!=="true"||
    [...form.keys()].some(key=>forbidden.some(re=>re.test(key))))
  throw Error("Managed Payments incompatible checkout parameters");
}
