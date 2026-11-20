"use client";

import {useEffect,useId,useRef,useState} from "react";
import Link from "next/link";
import {CustomerFeedback} from "@/components/customer-feedback";
import {requestErrorFeedback,type CustomerNotice} from "@/lib/live/customer-feedback";
import {MAX_CREDIT_TOPUP,MIN_CREDIT_TOPUP,parseCreditTopup,proposedTopupCents} from "@/lib/commerce/credit-topup-quote";

import "./credit-amount-picker.css";
const presets=[500,2000,4000,10000] as const;
const countryDisplay=new Intl.DisplayNames(["en"],{type:"region"});
const countries="AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ")
 .map(code=>({code,label:countryDisplay.of(code)||code}))
 .sort((a,b)=>a.label.localeCompare(b.label,"en"));

const num=(n:number)=>new Intl.NumberFormat("en-GB").format(n);
const euro=(n:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"EUR"}).format(n/100);

/** UI quote only; the server decides if this account may create a Stripe Checkout. */
type CheckoutAccess={state:"checking"|"ready"|"signed-out"|"unavailable";purchaseEnabled:boolean;testMode:boolean;emailVerification:string|null;globalCountrySelection:boolean;approvedBillingCountries:string[]|null};
export function CreditAmountPicker({purchaseEnabled=false,testMode=true,discoverAvailability=false,globalCountrySelection=false,approvedBillingCountries=null}:
 {purchaseEnabled?:boolean;testMode?:boolean;discoverAvailability?:boolean;globalCountrySelection?:boolean;approvedBillingCountries?:string[]|null}){
 const [checkoutAccess,setCheckoutAccess]=useState<CheckoutAccess>({
  state:"checking",purchaseEnabled:false,testMode:true,emailVerification:null,globalCountrySelection:false,approvedBillingCountries:null
 });
 useEffect(()=>{
  if(!discoverAvailability)return;
  let active=true;
  const refresh=async()=>{
   try{
    const response=await fetch("/api/credit-balance",{cache:"no-store",credentials:"same-origin"});
    if(response.status===401){
     if(active)setCheckoutAccess({state:"signed-out",purchaseEnabled:false,testMode:true,emailVerification:null,globalCountrySelection:false,approvedBillingCountries:null});
     return;
    }
    if(!response.ok)throw Error("Credit eligibility unavailable");
    const info=await response.json() as {purchaseEnabled?:unknown;testMode?:unknown;emailVerification?:unknown;globalCountrySelection?:unknown;approvedBillingCountries?:unknown};
    if(typeof info.purchaseEnabled!=="boolean"||typeof info.testMode!=="boolean")
     throw Error("Invalid Credit eligibility response");
    if(active)setCheckoutAccess({state:"ready",purchaseEnabled:info.purchaseEnabled,
     testMode:info.testMode,emailVerification:typeof info.emailVerification==="string"?info.emailVerification:null,
     globalCountrySelection:info.globalCountrySelection===true,
     approvedBillingCountries:Array.isArray(info.approvedBillingCountries)&&
      info.approvedBillingCountries.length<=250&&
      info.approvedBillingCountries.every(x=>typeof x==="string"&&/^[A-Z]{2}$/.test(x))
      ?info.approvedBillingCountries:null});
   }catch{
    if(active)setCheckoutAccess({state:"unavailable",purchaseEnabled:false,testMode:true,emailVerification:null,globalCountrySelection:false,approvedBillingCountries:null});
   }
  };
  void refresh();
  const onFocus=()=>void refresh();
  window.addEventListener("focus",onFocus);
  return()=>{active=false;window.removeEventListener("focus",onFocus);};
 },[discoverAvailability]);
 const canPurchase=discoverAvailability?checkoutAccess.state==="ready"&&checkoutAccess.purchaseEnabled:purchaseEnabled;
 const checkoutTestMode=discoverAvailability?checkoutAccess.testMode:testMode;
 const needsBillingCountry=discoverAvailability?checkoutAccess.globalCountrySelection:globalCountrySelection;
 const moRCountries=discoverAvailability?checkoutAccess.approvedBillingCountries:approvedBillingCountries;
 const selectableCountries=moRCountries?countries.filter(x=>moRCountries.includes(x.code)):countries;
 const [billingCountry,setBillingCountry]=useState("");
 const [buyerType,setBuyerType]=useState<"consumer"|"business">("consumer");
 const [raw,setRaw]=useState("500");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const requestKey=useRef<string|null>(null);
 const [status,setStatus]=useState<CustomerNotice|null>(null);
 const inputId=useId();
 const [creditsPerSecond,setCreditsPerSecond]=useState<number|null>(null);
 useEffect(()=>{
  let active=true;
  const load=()=>void fetch("/api/credit-tariff",{cache:"no-store"})
   .then(async response=>{
    if(!response.ok)throw Error("Video tariff unavailable");
    return await response.json() as {creditsPerSecond?:number};
   }).then(data=>{
    if(active)setCreditsPerSecond(typeof data.creditsPerSecond==="number"&&
     Number.isSafeInteger(data.creditsPerSecond)&&data.creditsPerSecond>=1?data.creditsPerSecond:null);
   }).catch(()=>{if(active)setCreditsPerSecond(null)});
  load();window.addEventListener("focus",load);
  return()=>{active=false;window.removeEventListener("focus",load)};
 },[]);
 const credits=parseCreditTopup(raw),cents=credits===null?null:proposedTopupCents(credits);
 const estimatedVideoSeconds=credits===null||creditsPerSecond===null?null:Math.floor(credits/creditsPerSecond);
 const begin=async()=>{
  if(!canPurchase||credits===null||busy||(needsBillingCountry&&(!billingCountry||(moRCountries!==null&&!moRCountries.includes(billingCountry)))))return;
  setBusy(true);setError("");setStatus(null);
  try{
   // Keep the exact interrupted Step 4 draft across the external Stripe redirect,
   // even if the sessionStorage context is lost when the buyer returns.
   const params=new URLSearchParams(window.location.search);
   let draftId=params.get("resumeDraft");
   let required=Number(params.get("requiredCredits"));
   if(!draftId||!/^[A-Za-z0-9_-]{1,80}$/.test(draftId)||!Number.isSafeInteger(required)||required<1||required>7500){
    try{
     const saved=JSON.parse(sessionStorage.getItem("sm-credit-checkout-resume")||"null") as
       {draftId?:unknown;requiredCredits?:unknown;created?:unknown}|null;
     if(saved&&typeof saved.draftId==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(saved.draftId)&&
       typeof saved.requiredCredits==="number"&&Number.isSafeInteger(saved.requiredCredits)&&
       saved.requiredCredits>=1&&saved.requiredCredits<=7500&&typeof saved.created==="number"&&
       Date.now()-saved.created>=0&&Date.now()-saved.created<7200000){
       draftId=saved.draftId;required=saved.requiredCredits;
     }else draftId=null;
    }catch{draftId=null;}
   }
   const resume=draftId&&Number.isSafeInteger(required)&&required>=1&&required<=7500
     ?{resumeDraft:draftId,requiredCredits:required}:{};
   const response=await fetch("/api/credit-checkout",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({credits:String(credits),requestKey:(requestKey.current??=crypto.randomUUID()),
      ...(needsBillingCountry?{billingCountry,buyerType}:{}),...resume}),
   });
   const data=await response.json() as {url?:string;error?:string;testMode?:boolean;supportReference?:string};
   if(!response.ok||data.testMode!==checkoutTestMode||typeof data.url!=="string"||
      !/^https:\/\/checkout\.stripe\.com\//.test(data.url))
    throw Error((data.error||"Stripe test checkout could not be started.")+
     (typeof data.supportReference==="string"&&/^req_[A-Za-z0-9]+$/.test(data.supportReference)
       ?" Stripe support reference: "+data.supportReference:""));
   window.location.assign(data.url);
  }catch(e){
   const message=e instanceof Error?e.message:"Stripe test checkout failed.";
   setError(message);setStatus(requestErrorFeedback(message,"payment"));setBusy(false);
  }
 };
 return <div className="sm-credit-amount-picker" aria-label="Buy Credits">
  <div className="sm-credit-amount-heading"><div><h2>Buy Credits</h2>
   <p>Choose a package or enter exactly how many credits you want.</p></div>
   {canPurchase&&<span className="sm-credit-amount-tag">{checkoutTestMode?"Stripe Test Mode":"Secure Stripe Checkout"}</span>}
  </div>
  <div className="sm-credit-presets" aria-label="Credit packages">
   {presets.map(amount=><button key={amount} type="button" aria-pressed={raw===String(amount)}
    className={raw===String(amount)?"sm-credit-preset selected":"sm-credit-preset"}
    onClick={()=>{setRaw(String(amount));setError("");setStatus(null);requestKey.current=null;}}>
    <strong>{num(amount)}</strong><span>Credits</span><small>{euro(amount)}</small>
   </button>)}
  </div>
  <div className="sm-credit-amount-field">
   <label htmlFor={inputId}>Enter a custom credit amount</label>
   <div className="sm-credit-amount-control"><input id={inputId} inputMode="numeric" type="number" step="1"
    min={MIN_CREDIT_TOPUP} max={MAX_CREDIT_TOPUP} value={raw}
    onChange={e=>{setRaw(e.target.value);setError("");setStatus(null);requestKey.current=null;}}
    aria-invalid={credits===null} aria-describedby={inputId+"-hint"}/><span>Credits</span></div>
   <p id={inputId+"-hint"} className={credits===null?"sm-credit-amount-error":"sm-credit-amount-helper"}>
    {credits===null?"Enter 500 to 100,000 whole credits.":"1 Credit = €0.01."}</p>
  </div>
  {needsBillingCountry&&<div className="sm-credit-country-fields">
    <label htmlFor={inputId+"-country"}>Billing country</label>
    <select id={inputId+"-country"} value={billingCountry} required
     onChange={e=>{setBillingCountry(e.target.value);requestKey.current=null;setError("");}}>
     <option value="">Select your billing country</option>
     {selectableCountries.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}
    </select>
    <label htmlFor={inputId+"-buyer"}>Customer type</label>
    <select id={inputId+"-buyer"} value={buyerType}
     onChange={e=>{setBuyerType(e.target.value as "consumer"|"business");requestKey.current=null;setError("");}}>
     <option value="consumer">Individual</option><option value="business">Business</option>
    </select>
    <p>Your billing country and customer type must be eligible for this purchase. Stripe verifies the billing address at Checkout.</p>
   </div>}
  <div className="sm-credit-amount-total" aria-live="polite">
   <div><span>Credits</span><strong>{credits===null?"—":num(credits)}</strong></div>
   <div><span>Estimated payment</span><strong>{cents===null?"—":euro(cents)}</strong></div>
   <div><span>Estimated AI Video Seconds</span><strong>{estimatedVideoSeconds===null?"—":num(estimatedVideoSeconds)+" s"}</strong></div>
   <p className="sm-credit-amount-seconds-note">Total source-audio time at {creditsPerSecond===null?"a currently unverified rate":creditsPerSecond+" Credits per started second"}. Individual video limits apply.</p>
  </div>
  {canPurchase?<button type="button" className="sm-credit-amount-disabled sm-credit-buy-enabled" disabled={busy||credits===null||(needsBillingCountry&&(!billingCountry||(moRCountries!==null&&!moRCountries.includes(billingCountry))))} onClick={()=>void begin()}>
   {busy?"Opening Stripe…":checkoutTestMode?"Test purchase with Stripe":"Buy securely with Stripe"}
  </button>:discoverAvailability&&checkoutAccess.state==="signed-out"?<Link href="/login" className="sm-credit-amount-disabled sm-credit-buy-enabled">Sign in to buy Credits</Link>:
   discoverAvailability&&checkoutAccess.state==="ready"&&checkoutAccess.emailVerification==="pending"?<Link href="/account/verify-email" className="sm-credit-amount-disabled sm-credit-buy-enabled">Verify email to buy Credits</Link>:
   <div className="sm-credit-amount-disabled" aria-disabled="true">{discoverAvailability&&checkoutAccess.state==="checking"?"Checking purchase availability…":
     discoverAvailability&&checkoutAccess.state==="unavailable"?"Purchase availability cannot be verified":
     "Credit purchases are not yet available for this account"}</div>}
  <CustomerFeedback notice={status??(busy?{key:"checkout-opening",kind:"info",title:"Opening secure checkout",message:"Please keep this page open. Credits are added only after verified payment."}:null)} context="payment"/>
  {error&&/Stripe support reference: (req_[A-Za-z0-9]+)/.test(error)&&<p className="sm-credit-amount-error">Stripe support reference: {error.match(/Stripe support reference: (req_[A-Za-z0-9]+)/)?.[1]}</p>}
  {!(discoverAvailability&&checkoutAccess.state==="signed-out")&&<p className="sm-credit-amount-footer">{canPurchase
   ?checkoutTestMode?"Stripe Test Mode only: use test card details. No real money is charged. Credits are added only after Stripe confirms payment.":"One-time payment through Stripe. Credits are issued only after verified payment and billing-country checks. Credit voucher treatment and local taxes vary by jurisdiction. There are no automatic top-ups or recurring charges."
   :discoverAvailability&&checkoutAccess.state==="ready"&&checkoutAccess.emailVerification==="pending"?"Verify your email before buying Credits. No payment has been started."
   :discoverAvailability&&checkoutAccess.state==="checking"?"Checking account eligibility with the secure Credit service."
   :discoverAvailability&&checkoutAccess.state==="unavailable"?"Credit purchase availability could not be checked. No payment has been started."
   :discoverAvailability?"Credit Checkout is not yet approved for this account. No payment has been started."
   :"These prices are for information only. Live payments are not enabled. No automatic payments will be taken."}</p>}
 </div>;
}
