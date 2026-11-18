/**
 * Stripe Managed Payments is the merchant of record for its supported
 * digital-good markets. Stripe must explicitly approve the account AND this
 * exact prepaid-credit product: an AIaaS tax code alone is not eligibility.
 * The code never makes an undocumented tax exemption or overrides sanctions.
 */
const RESTRICTED=new Set(["CN","CU","IR","XK","KP","RU","SY","AC","TA"]);
// The buyer-country list is broader than Stripe's tax-liability coverage.
// It is NOT a claim that Stripe must accept every buyer or transaction.
const BUYER_COUNTRIES=new Set(
 "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ")
);
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
export function approvedMoRTaxCountries():string[]{
 return [...STRIPE_MANAGED_TAX_COVERED_COUNTRIES].filter(country=>managedCreditBuyerSupported(country)).sort();
}
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
 return typeof country==="string"&&BUYER_COUNTRIES.has(country)&&
  !RESTRICTED.has(country);
}
/** Broadly supported Managed Payments buyer countries, not just tax-covered.
 * RS is conditional on the seller being NOT registered for Serbian VAT.
 * Keep this independent evidence requirement rather than guessing.
 */
export function approvedMoRBuyerCountries(env:Record<string,string|undefined>={}):string[]{
 return [...BUYER_COUNTRIES].filter(country=>
   managedCreditBuyerSupported(country)&&
   (country!=="RS"||env.STRIPE_MANAGED_PAYMENTS_SERBIA_NO_VAT_REGISTRATION_CONFIRMED==="true")
 ).sort();
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
 // Stripe permits Serbia only where the seller is not registered for
 // Serbian VAT; a general tax-responsibility decision cannot prove this.
 if(country==="RS"&&env.STRIPE_MANAGED_PAYMENTS_SERBIA_NO_VAT_REGISTRATION_CONFIRMED!=="true")
  return {ready:false,reason:"STRIPE_SERBIA_VAT_CONDITION_UNVERIFIED",decision:null};
 const stripeHandlesTax=managedCreditMoRTaxCovered(country);
 // Managed Payments remains the MoR for payments, while the seller is
 // responsible for indirect tax in tax-unsupported destinations. Stripe Tax
 // is configured in the Dashboard; do not send forbidden automatic_tax params.
 return {ready:true,reason:stripeHandlesTax?"STRIPE_MERCHANT_OF_RECORD":"SELLER_TAX_RESPONSIBILITY",decision:{
  country:country as string,buyerType:buyerType as "consumer"|"business",voucherKind:"merchant-of-record-determined" as const,
  mode:"stripe-managed-payments" as const,
  revision:stripeHandlesTax?"stripe-mor-v1":"stripe-mor-seller-tax-v1",
  taxAtIssue:false,taxCode:env.STRIPE_CREDIT_TAX_CODE!,
 }};
}

/** Decide the legal destination from a separately verified paid Stripe
 * Checkout session, never from a customer-entered browser parameter.
 * Tax-ID presence is only internal classification; Stripe handles MoR tax.
 */
export function managedCreditTaxDecisionFromVerifiedStripe(
 env:Record<string,string|undefined>,
 details:{address?:{country?:string}|null;tax_ids?:Array<{type?:string;value?:string}>|null}|null|undefined,
){
 const buyerType=Array.isArray(details?.tax_ids)&&details.tax_ids.length>0?"business":"consumer";
 return managedCreditTaxDecision(env,details?.address?.country,buyerType);
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
