/**
 * Fail-closed jurisdiction engine for prepaid, video-only Credits.
 *
 * Country of the *buyer* is not sufficient to determine place of supply or
 * voucher tax point. A reviewed country policy contains the merchant's signed
 * conclusion; no fallback to German §19 status for foreign sales.
 * A multi-purpose voucher cannot be charged until a separate, reviewed
 * redemption-time tax ledger is installed.
 */
export type BuyerType="consumer"|"business";
export type VoucherKind="single-purpose"|"multi-purpose";
export type CreditTaxMode="de-small-business"|"eu-sme-exempt"|"stripe-tax"|"reviewed-no-tax";
export type CreditTaxDecision={
 country:string;buyerType:BuyerType;voucherKind:VoucherKind;
 mode:CreditTaxMode;revision:string;taxAtIssue:boolean;taxCode:string|null;
};
type TaxPolicy={revision:string;reviewedAt:string;entries:Array<{
 country:string;buyerType:BuyerType;voucherKind:VoucherKind;mode:CreditTaxMode;
 evidence:string;exNumber?:string;taxRegistrationEvidence?:string;
}>};
const DE="DE";
const COUNTRY=/^[A-Z]{2}$/;
const EEA_EU=new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
function readPolicy(env:Record<string,string|undefined>):TaxPolicy|null{
 if(env.CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED!=="true"||
    !env.CREDIT_TAX_COUNTRY_POLICY_JSON||
    env.CREDIT_TAX_COUNTRY_POLICY_JSON.length>50000)return null;
 try{
  const parsed=JSON.parse(env.CREDIT_TAX_COUNTRY_POLICY_JSON) as TaxPolicy;
  if(!parsed||typeof parsed.revision!=="string"||
     !/^[A-Za-z0-9_.-]{4,50}$/.test(parsed.revision)||
     typeof parsed.reviewedAt!=="string"||
     !/^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/.test(parsed.reviewedAt)||
     !Number.isFinite(Date.parse(parsed.reviewedAt))||
     Date.parse(parsed.reviewedAt)>Date.now()||
     Date.now()-Date.parse(parsed.reviewedAt)>93*86400000||
     !Array.isArray(parsed.entries)||parsed.entries.length>500)return null;
  const keys=new Set<string>();
  for(const x of parsed.entries){
   if(!x||typeof x.country!=="string"||!COUNTRY.test(x.country)||
      !["consumer","business"].includes(x.buyerType)||
      !["single-purpose","multi-purpose"].includes(x.voucherKind)||
      !["de-small-business","eu-sme-exempt","stripe-tax","reviewed-no-tax"].includes(x.mode)||
      typeof x.evidence!=="string"||x.evidence.trim().length<24||x.evidence.length>1200)return null;
   const key=x.country+":"+x.buyerType;
   if(keys.has(key))return null;
   keys.add(key);
   if(x.mode==="de-small-business"&&x.country!==DE)return null;
   if(x.mode==="eu-sme-exempt"&&
      (!EEA_EU.has(x.country)||x.country===DE||
       !/^DE[A-Za-z0-9.-]{4,24}EX$/.test(x.exNumber||"")))return null;
   if(x.mode==="stripe-tax"&&!x.taxRegistrationEvidence?.trim())return null;
   if(x.mode==="reviewed-no-tax"&&x.country===DE)return null;
  }
  return parsed;
 }catch{return null;}
}
/** No approval is derived from nationality, IP or payment card alone. */
export function assessWorldwideCreditTax(
 env:Record<string,string|undefined>,country:unknown,buyerType:unknown
):{ready:boolean;reason:string;decision:CreditTaxDecision|null}{
 if(typeof country!=="string"||!COUNTRY.test(country)||
    (buyerType!=="consumer"&&buyerType!=="business"))
  return {ready:false,reason:"VALID_BILLING_COUNTRY_AND_CUSTOMER_TYPE_REQUIRED",decision:null};
 const p=readPolicy(env);
 if(!p)return {ready:false,reason:"REVIEWED_WORLDWIDE_TAX_POLICY_REQUIRED",decision:null};
 const entry=p.entries.find(x=>x.country===country&&x.buyerType===buyerType);
 if(!entry)return {ready:false,reason:"COUNTRY_AND_CUSTOMER_TYPE_NOT_YET_REVIEWED",decision:null};
 if(entry.voucherKind==="multi-purpose")
  return {ready:false,reason:"REDEMPTION_TIME_TAX_LEDGER_NOT_APPROVED",decision:null};
 if(entry.mode==="de-small-business"&&env.CREDIT_TAX_DE_KLEINUNTERNEHMER_APPROVED!=="true")
  return {ready:false,reason:"GERMAN_SMALL_BUSINESS_STATUS_NOT_CONFIRMED",decision:null};
 const taxCode=entry.mode==="stripe-tax"?env.STRIPE_CREDIT_TAX_CODE||null:null;
 if(entry.mode==="stripe-tax"&&(!/^txcd_[A-Za-z0-9]+$/.test(taxCode||"")||
    env.STRIPE_CREDIT_TAX_REVIEW_APPROVED!=="true"))
  return {ready:false,reason:"STRIPE_TAX_CODE_REVIEW_REQUIRED",decision:null};
 return {ready:true,reason:"REVIEWED",decision:{
  country,buyerType:buyerType as BuyerType,voucherKind:entry.voucherKind,
  mode:entry.mode,revision:p.revision,taxAtIssue:true,taxCode,
 }};
}
export function worldwideTaxPolicyAvailable(env:Record<string,string|undefined>){
 return readPolicy(env)!==null;
}
