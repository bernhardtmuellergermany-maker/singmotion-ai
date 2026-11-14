"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Shell} from "@/components/shell";

type Auth={authenticated?:boolean;kind?:string;email?:string|null;emailVerification?:"pending"|"verified"|"legacy"};
type Resume={draftId:string;requiredCredits:number;created:number};
const RESUME_KEY="sm-credit-checkout-resume";
function savedStudioResume():Resume|null{
 try{
  const item=JSON.parse(sessionStorage.getItem(RESUME_KEY)||"null") as Resume|null;
  if(!item||typeof item.draftId!=="string"||!/^[A-Za-z0-9_-]{1,80}$/.test(item.draftId)||
     !Number.isSafeInteger(item.requiredCredits)||item.requiredCredits<1||item.requiredCredits>7500||
     typeof item.created!=="number"||Date.now()-item.created<0||Date.now()-item.created>2*60*60*1000)return null;
  return item;
 }catch{return null;}
}
export default function VerifyEmail(){
 const [token,setToken]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [verified,setVerified]=useState(false);
 const [account,setAccount]=useState<Auth|null>(null);
 const [resume,setResume]=useState<Resume|null>(null);
 useEffect(()=>{
  let active=true;
  setToken(new URLSearchParams(window.location.search).get("token")||"");
  setResume(savedStudioResume());
  const refresh=async()=>{
   try{
    const response=await fetch("/api/customer-auth",{credentials:"same-origin",cache:"no-store"});
    const result=response.ok?await response.json() as Auth:null;
    if(active){setAccount(result);if(result?.authenticated&&
      (result.emailVerification==="verified"||result.emailVerification==="legacy"))setVerified(true);}
   }catch{if(active)setAccount(null)}
  };
  void refresh();
  const focus=()=>{void refresh()};
  window.addEventListener("focus",focus);window.addEventListener("pageshow",focus);
  return()=>{active=false;window.removeEventListener("focus",focus);window.removeEventListener("pageshow",focus)};
 },[]);
 async function confirm(){
  if(!token||busy)return;
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/customer-email-verification",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"confirm",token}),
   });
   const result=await response.json() as {error?:string};
   if(!response.ok)throw Error(result.error||"Email verification failed");
   setVerified(true);setToken("");
   setMessage("Your email is verified. You can now buy Credits for your saved video.");
   window.history.replaceState(null,"","/account/verify-email");
   const identity=await fetch("/api/customer-auth",{credentials:"same-origin",cache:"no-store"});
   if(identity.ok)setAccount(await identity.json() as Auth);
  }catch(error){setMessage(error instanceof Error?error.message:"Verification failed.")}
  finally{setBusy(false)}
 }
 async function resend(){
  if(busy)return;
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/customer-email-verification",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"resend"}),
   });
   const result=await response.json() as {error?:string;message?:string};
   if(!response.ok)throw Error(result.error||"Unable to send verification email.");
   setMessage(result.message||"Check your inbox and spam folder.");
  }catch(error){setMessage(error instanceof Error?error.message:"Could not resend verification email.");}
  finally{setBusy(false)}
 }
 const signedIn=account?.authenticated===true&&account.kind==="customer";
 const confirmed=signedIn&&(account?.emailVerification==="verified"||account?.emailVerification==="legacy");
 const buyUrl=resume?
  "/credits?resumeDraft="+encodeURIComponent(resume.draftId)+"&requiredCredits="+resume.requiredCredits+"#buy-credits":
  "/credits#buy-credits";
 return <Shell hideWorkspaceNav><main className="product-theme" style={{
  maxWidth:550,margin:"54px auto",padding:"clamp(20px,4vw,32px)",
  color:"#eee8ff",background:"linear-gradient(145deg,#281a38,#11121f)",
  border:"1px solid #754ea0",borderRadius:20,boxShadow:"0 16px 40px #0006"}}>
  <span style={{color:"#c883ff",fontSize:12,fontWeight:700,letterSpacing:".1em"}}>SINGMOTION AI · ACCOUNT</span>
  <h1 style={{fontSize:29,margin:"12px 0"}}>{confirmed||verified?"Email verified!":"Verify your email"}</h1>
  <p style={{color:"#cbbbdc",lineHeight:1.6}}>
   {confirmed||verified?
    "Your account is free and ready. The next step is to buy Credits for your video, if needed.":
    "Your account is free. Confirm your email address before purchasing Credits. Your uploaded audio, photo and saved Studio project are preserved."}
  </p>
  {resume&&<div style={{border:"1px solid #69468c",background:"#382347",borderRadius:12,padding:14,margin:"15px 0"}}>
   <strong>Your video is saved</strong>
   <p style={{margin:"6px 0 0",fontSize:13,color:"#dbc8e8"}}>
    You need {resume.requiredCredits.toLocaleString("en-GB")} Credits. After your verified purchase, you'll return to Step 4 to click Generate Video.
   </p>
  </div>}
  {!confirmed&&token&&<button type="button" disabled={busy} onClick={()=>void confirm()}
   className="product-primary" style={{width:"100%",minHeight:46,margin:"8px 0"}}>
   {busy?"Verifying…":"Confirm email address"}
  </button>}
  {!confirmed&&!token&&!verified&&<p style={{fontSize:13,color:"#cfbfdc"}}>
   Open the verification link in your email. Check spam or request another email below.
  </p>}
  {!confirmed&&!verified&&signedIn&&<button type="button" className="product-secondary"
   disabled={busy} onClick={()=>void resend()} style={{width:"100%",minHeight:44,margin:"8px 0"}}>
   {busy?"Sending…":"Resend verification email"}
  </button>}
  {(confirmed||verified)&&<div style={{margin:"22px 0 10px"}}>
   {confirmed?<Link href={buyUrl} className="product-primary" style={{
    display:"flex",alignItems:"center",justifyContent:"center",minHeight:49,textDecoration:"none",borderRadius:11}}>
    Buy Credits for your video
   </Link>:<Link href="/login" className="product-primary" style={{
    display:"flex",alignItems:"center",justifyContent:"center",minHeight:49,textDecoration:"none",borderRadius:11}}>
    Sign in to buy Credits
   </Link>}
   <p style={{fontSize:12,color:"#bcaacf",lineHeight:1.5}}>
    No charge for verifying your email. Stripe payment is a separate, optional action. Checkout opens only when enabled.
   </p>
  </div>}
  {message&&<p role="status" style={{color:"#e8cdfb",lineHeight:1.5}}>{message}</p>}
  <p style={{fontSize:13,marginTop:22}}>
   <Link href="/account/settings" style={{color:"#d4a7ff"}}>Account settings</Link>
   {" · "}<Link href="/studio" style={{color:"#d4a7ff"}}>Studio</Link>
  </p>
 </main></Shell>;
}
