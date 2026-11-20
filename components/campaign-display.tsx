"use client";
import {useEffect,useState} from "react";
import type {PublicTariff} from "@/lib/commerce/campaign-pricing";

/** Presentation-only. Both price display and authoritative Studio hold use
 * the same versioned /api/credit-tariff source; failed reads display nothing. */
function useCampaign(){
 const [tariff,setTariff]=useState<PublicTariff|null>(null);
 useEffect(()=>{
  let active=true;
  const reload=()=>void fetch("/api/credit-tariff",{cache:"no-store"})
   .then(async r=>{if(!r.ok)throw Error("Tariff not verified");return await r.json() as PublicTariff})
   .then(data=>{if(active)setTariff(data)})
   .catch(()=>{if(active)setTariff(null)});
  reload();
  const focus=()=>reload();
  window.addEventListener("focus",focus);
  return()=>{active=false;window.removeEventListener("focus",focus)};
 },[]);
 return tariff?.campaignId?tariff:null;
}
export function CampaignLogoBadge(){
 const item=useCampaign();
 if(!item?.showBadge||!item.badgeText)return null;
 return <span className="sm-campaign-logo-badge" data-theme={item.theme}
  style={{"--campaign-accent":item.accent} as React.CSSProperties}>
  {item.badgeText}</span>;
}
export function CampaignOfferLine(){
 const item=useCampaign();
 if(!item?.showBanner)return null;
 const euro=new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"})
  .format(item.creditsPerSecond/100);
 return <div className="sm-campaign-offer-line" data-theme={item.theme}
  style={{"--campaign-accent":item.accent} as React.CSSProperties}
  aria-label={item.heading||"Current video offer"}>
   <strong>{item.badgeText||item.heading||"SPECIAL"}</strong>
   <span aria-hidden="true">·</span>
   <span>{euro} / sec</span>
   {item.discountPercent!==null&&<>
    <span aria-hidden="true">·</span><strong>{item.discountPercent}% OFF</strong>
   </>}
   {item.actionHint&&<small>{item.actionHint}</small>}
 </div>;
}
