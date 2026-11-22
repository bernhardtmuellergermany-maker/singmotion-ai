"use client";
import {useEffect,useState} from "react";

type Data={enabled:boolean;code?:string;referrerCredits?:number;friendCredits?:number;
 minimumPurchaseCredits?:number;holdDays?:number;qualified?:number;earnedCredits?:number};
export function ReferralInvite(){
 const [data,setData]=useState<Data|null>(null);
 const [copied,setCopied]=useState(false);
 useEffect(()=>{
  let active=true;
  void fetch("/api/referrals",{cache:"no-store",credentials:"same-origin"})
   .then(r=>r.ok?r.json():{enabled:false})
   .then((v:Data)=>{if(active)setData(v);})
   .catch(()=>{if(active)setData({enabled:false});});
  return()=>{active=false};
 },[]);
 if(!data?.enabled||!data.code)return null;
 const path="/r/"+encodeURIComponent(data.code);
 const copy=()=>{void navigator.clipboard.writeText(window.location.origin+path).then(()=>setCopied(true)).catch(()=>setCopied(false));};
 return <section className="sm-credits-notice" aria-label="Refer & Earn">
  <h2>Refer & Earn · Invite a friend</h2>
  <p>Share your personal link. After your friend joins, verifies their account and makes their first qualifying Credit purchase of at least {data.minimumPurchaseCredits} Credits, you receive <strong>{data.referrerCredits} Credits</strong> and your friend receives <strong>{data.friendCredits} Credits</strong>.</p>
  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
   <code style={{overflowWrap:"anywhere"}}>{path}</code>
   <button type="button" className="sm-plan-action sm-plan-action-outline" onClick={copy}>{copied?"Link copied":"Copy invite link"}</button>
  </div>
  <p className="sm-credits-muted">Rewards are reviewed for {data.holdDays} days after the verified purchase. Qualifying referrals: {data.qualified}. Credits earned: {data.earnedCredits}. No cash payout; refunded or disputed payments do not qualify.</p>
 </section>;
}
