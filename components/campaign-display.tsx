"use client";
import {useEffect,useState} from "react";
import type {CSSProperties} from "react";
import Link from "next/link";
import {Rocket,Clock3} from "lucide-react";
import type {PublicTariff} from "@/lib/commerce/campaign-pricing";
import {readCustomerAuthStatus} from "@/lib/client-auth-status";
import {CREDIT_BUY_RETURN} from "@/lib/studio-account-handoff";
import "./campaign-display.css";

/** All campaign copy and prices originate from the same server-side versioned tariff.
 * Never turn a failed read into a guessed promotion or a Stripe purchase.
 */
function useVideoTariff(){
 const [tariff,setTariff]=useState<PublicTariff|null>(null);
 useEffect(()=>{
  let mounted=true;
  const reload=()=>void fetch("/api/credit-tariff",{cache:"no-store"})
    .then(async response=>{
      if(!response.ok)throw Error("Video tariff is unavailable");
      return await response.json() as PublicTariff;
    }).then(value=>{
      if(mounted&&Number.isSafeInteger(value.creditsPerSecond)&&value.creditsPerSecond>=1)
       setTariff(value);
      else if(mounted)setTariff(null);
    }).catch(()=>{if(mounted)setTariff(null)});
  const refresh=()=>{if(document.visibilityState==="visible")reload()};
  reload();window.addEventListener("focus",reload);
  document.addEventListener("visibilitychange",refresh);
  return()=>{mounted=false;window.removeEventListener("focus",reload);
   document.removeEventListener("visibilitychange",refresh)};
 },[]);
 return tariff;
}
const euro=(credits:number)=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(credits/100);
function palette(tariff:PublicTariff):CSSProperties{
 return {"--campaign-accent":tariff.accent} as CSSProperties;
}
function CampaignPriceLine({tariff}:{tariff:PublicTariff}){
 return <span className="sm-campaign-rate-line">
  <strong>{euro(tariff.creditsPerSecond)} / sec</strong>
  {tariff.showDiscountPercent&&tariff.discountPercent!==null&&<em>{tariff.discountPercent}% OFF</em>}
  {tariff.showRegularPrice&&tariff.discountPercent!==null&&
   <del className="sm-campaign-rate-regular">{euro(tariff.regularCreditsPerSecond)} / sec</del>}
 </span>;
}
export function CampaignLogoBadge(){
 const tariff=useVideoTariff();
 if(!tariff?.campaignId||!tariff.showBadge||!tariff.badgeText)return null;
 return <span className="sm-campaign-logo-badge" data-theme={tariff.theme}
  style={palette(tariff)} title={tariff.badgeText}>{tariff.badgeText}</span>;
}
/** Offer-only visual component. The real studio CTA remains untouched above it. */
export function CampaignOfferLine(){
 const tariff=useVideoTariff();
 if(!tariff?.campaignId||!tariff.showBanner)return null;
 // Compare the confirmed regular tariff, not an asserted historical price.
 const discounted=tariff.discountPercent!==null&&
  tariff.creditsPerSecond<tariff.regularCreditsPerSecond;
 const badge=tariff.badgeText||"SPECIAL";
 const offerLabel=/\boffer$/i.test(badge)?badge:badge+" Offer";
 const loginHref="/login?returnTo="+encodeURIComponent(CREDIT_BUY_RETURN);
 const buyCredits=(event:import("react").MouseEvent<HTMLAnchorElement>)=>{
  event.preventDefault();
  // Never trust cached identity or navigate around the customer login check.
  void readCustomerAuthStatus().then(status=>{
   window.location.assign(status?.authenticated===true&&(status.kind==="customer"||status.kind==="staff")
    ?CREDIT_BUY_RETURN:loginHref);
  }).catch(()=>window.location.assign(loginHref));
 };
 return <div className="sm-campaign-offer-block" data-theme={tariff.theme} style={palette(tariff)}>
  <Link className="sm-campaign-offer-line" href={loginHref}
   aria-label={(tariff.heading||"Current video offer")+". Buy Credits"}
   onClick={buyCredits}>
   <span className="sm-campaign-offer-identity">
    <Rocket size={20} strokeWidth={2.5} aria-hidden="true"/>
    <strong className="sm-campaign-offer-name">{offerLabel}</strong>
   </span>
   <span className="sm-campaign-offer-divider" aria-hidden="true"/>
   <strong className="sm-campaign-offer-current">{euro(tariff.creditsPerSecond)} / sec</strong>
   {discounted&&tariff.showDiscountPercent&&
    <span className="sm-campaign-offer-discount">{tariff.discountPercent}% OFF</span>}
   {discounted&&tariff.showRegularPrice&&
    <del className="sm-campaign-offer-regular" aria-label="Regular price">{euro(tariff.regularCreditsPerSecond)} / sec</del>}
  </Link>
  <div className="sm-campaign-offer-meta">
   <small className="sm-campaign-offer-hint"><Clock3 size={15} strokeWidth={2} aria-hidden="true"/>
    {tariff.actionHint||"Limited-time offer"}</small>
  </div>
 </div>;
}
/** The same offer appears on Pricing and Credits, including all CMS copy fields. */
export function CampaignPricingBanner({placement}:{placement:"pricing"|"credits"}){
 const tariff=useVideoTariff();
 if(!tariff?.campaignId||!tariff.showBanner)return null;
 return <aside className={"sm-campaign-pricing-banner sm-campaign-pricing-"+placement}
   data-theme={tariff.theme} style={palette(tariff)} aria-label={tariff.heading||"Video credit offer"}>
   <span className="sm-campaign-pricing-light-sweep" aria-hidden="true"/>
   <div className="sm-campaign-pricing-copy">
    <span className="sm-campaign-pricing-eyebrow"><Rocket size={20} strokeWidth={2.3} aria-hidden="true"/>{tariff.badgeText||"SPECIAL"} · LIMITED VIDEO RATE</span>
    {tariff.heading&&<h2>{tariff.heading}</h2>}
    {tariff.description&&<p>{tariff.description}</p>}
    <div className="sm-campaign-pricing-price"><CampaignPriceLine tariff={tariff}/></div>
    {tariff.actionHint&&<small>{tariff.actionHint}</small>}
   </div>
   {tariff.ctaText&&<Link className="sm-campaign-pricing-link" href={placement==="pricing"?"/credits#buy-credits":"#buy-credits"}>{tariff.ctaText}</Link>}
  </aside>;
}
/** No static 25-credit comparison on the pricing page while a discount is live. */
export function CurrentVideoRate(){
 const tariff=useVideoTariff();
 if(!tariff)return <div className="sm-live-tariff-pending" role="status">Checking the current video rate…</div>;
 const n=(value:number)=>new Intl.NumberFormat("de-DE").format(value);
 return <>
  <div className="sm-plan-price" data-price-version={tariff.version}>
   {tariff.creditsPerSecond} Credits <span>per started second of source audio · current verified rate</span>
  </div>
  <p className="sm-plan-price-note">1 Credit = €0.01. Your video price uses the duration of your original audio and the active rate confirmed in Studio, not playback speed.</p>
  <div className="sm-plan-examples" aria-label="Current video credit costs">
   {[10,30,60].map(seconds=><div key={seconds}>
    <span className="sm-campaign-duration">{seconds} seconds</span>
    <strong>{n(seconds*tariff.creditsPerSecond)} Credits
     <small>{euro(seconds*tariff.creditsPerSecond)}</small></strong>
   </div>)}
  </div>
 </>;
}