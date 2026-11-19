"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {ensureSession} from "@/lib/client";
import {quoteVideoCredits} from "@/lib/commerce/video-credit-quote";
import {parseStudioAccountReturn,STUDIO_ACCOUNT_RESUME_KEY} from "@/lib/studio-account-handoff";

/** Explicit resume checkpoint between anonymous Studio and a personal wallet.
 * No payment is started here. Never transfer another user's draft based only
 * on the URL; the server requires the original HttpOnly guest session token.
 */
export function StudioAccountResume(){
 const [message,setMessage]=useState("Verifying your account and saved project…");
 const [error,setError]=useState("");
 const [running,setRunning]=useState(true);
 const [attempt,setAttempt]=useState(0);
 const [retryLogin,setRetryLogin]=useState("/login");
 useEffect(()=>{
  let current=true;
  const proceed=async()=>{
   try{
    const params=new URLSearchParams(window.location.search);
    const oauthError=params.get("google_error");
    params.delete("google_error");
    params.delete("auth_changed");
    const original="/studio/continue?"+params.toString();
    const wanted=parseStudioAccountReturn(original);
    if(!wanted)throw Error("This Studio return link is invalid. Your original guest project has not been changed.");
    if(current)setRetryLogin("/login?returnTo="+encodeURIComponent(original));
    if(oauthError)throw Error("Google sign-in was not completed. "+oauthError);
    const stored=JSON.parse(sessionStorage.getItem(STUDIO_ACCOUNT_RESUME_KEY)||"null") as
     {draftId?:string;requiredCredits?:number;created?:number}|null;
    if(!stored||stored.draftId!==wanted.draftId||stored.requiredCredits!==wanted.requiredCredits||
       !Number.isFinite(stored.created)||typeof stored.created!=="number"||
       Date.now()-stored.created<0||Date.now()-stored.created>2*60*60*1000)
     throw Error("The private guest project handoff has expired. Open Step 4 in your original browser and sign in again.");
    const identityResponse=await fetch("/api/customer-auth",{cache:"no-store",credentials:"same-origin"});
    const identity=await identityResponse.json().catch(()=>null) as {authenticated?:boolean;kind?:string;emailVerification?:"pending"|"verified"|"legacy"}|null;
    if(!identityResponse.ok||identity?.authenticated!==true||identity.kind!=="customer")
     throw Error("Sign in to your customer account before transferring your guest project.");
    const workspace=await ensureSession() as {owner?:string};
    if(!workspace.owner?.startsWith("customer-"))
     throw Error("Customer workspace verification failed; your original guest files remain protected.");
    if(!current)return;
    setMessage("Transferring the saved audio, photo and Step 4 setup to your account…");
    const importResponse=await fetch("/api/customer-guest-import",{
     method:"POST",credentials:"same-origin",cache:"no-store",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({mode:"execute",confirmation:"IMPORT MY GUEST PROJECTS",draftId:wanted.draftId}),
    });
    const imported=await importResponse.json().catch(()=>null) as {imported?:boolean;error?:string}|null;
    // A retry after a successful transfer may no longer have a guest draft;
    // still require an authenticated same-owner draft check below.
    if(!importResponse.ok&&importResponse.status!==404)
     throw Error(imported?.error||"The private project could not be transferred. No payment was made.");
    if(!current)return;
    setMessage("Checking that your audio, photo and saved video setup belong to your account…");
    const draftResponse=await fetch("/api/studio-drafts/"+encodeURIComponent(wanted.draftId),{
     credentials:"same-origin",cache:"no-store"
    });
    if(!draftResponse.ok)throw Error("Your guest draft has not been verified in this account. We have not opened checkout.");
    const saved=await draftResponse.json() as {selection?:{owner?:string;start?:number;end?:number};song?:{kind?:string};image?:{kind?:string}};
    const quote=typeof saved.selection?.start==="number"&&typeof saved.selection?.end==="number"
     ?quoteVideoCredits(saved.selection.start,saved.selection.end):null;
    if(saved.selection?.owner!==workspace.owner||saved.song?.kind!=="audio"||
       saved.image?.kind!=="image"||!quote||quote.credits!==wanted.requiredCredits)
     throw Error("Saved project ownership, files or video price changed. Review Step 4 before buying Credits.");
    sessionStorage.setItem("sm-credit-checkout-resume",JSON.stringify({
     draftId:wanted.draftId,requiredCredits:quote.credits,created:Date.now(),
    }));
    // The customer asked to SIGN IN first, not to buy Credits or generate.
    // Always restore Step 4, even if email verification or wallet funding
    // will be needed later. Step 4 displays the actual wallet and asks for
    // any required action explicitly, without charging or starting a job.
    // A new password account can verify its email when they choose to buy.
    if(!current)return;
    setMessage("Your audio, photo and video settings are safe. Returning to Step 4…");
    sessionStorage.removeItem(STUDIO_ACCOUNT_RESUME_KEY);
    window.location.assign("/studio?draft="+encodeURIComponent(wanted.draftId)+"&resume=review");
   }catch(cause){
    if(current){setError(cause instanceof Error?cause.message:"Could not verify saved project.");setRunning(false);}
   }
  };
  void proceed();
  return()=>{current=false;};
 },[attempt]);
 return <section style={{width:"min(620px,calc(100% - 32px))",margin:"7vh auto",padding:24,
  border:"1px solid #7953a4",borderRadius:22,background:"#0b0f1b",color:"#f5edff"}}>
  <h1 style={{fontSize:28}}>Continue your video</h1>
  <p role="status">{message}</p>
  {!error?<p>Your account is free. No Stripe payment or video generation starts until you explicitly choose it.</p>:
   <div role="alert">
    <p>{error}</p>
    <p>We did not charge Credits or submit a video. Your original guest project remains protected.</p>
    <button type="button" className="product-secondary" disabled={running}
     onClick={()=>{setError("");setRunning(true);setAttempt(n=>n+1);}}>Try again</button>
    <p><Link href="/studio">Back to Studio</Link> · <Link href={retryLogin}>Sign in</Link></p>
   </div>}
 </section>;
}
