"use client";
import {useEffect,useRef,useState} from "react";
import {studioAccountReturn,STUDIO_ACCOUNT_RESUME_KEY} from "@/lib/studio-account-handoff";

/** A guest never enters the operator/payments dialog. They must verify an
 * account, then transfer only the guest workspace proved by HttpOnly cookies.
 * This component performs NO Stripe purchase and NO video generation.
 */
export function StudioAccountGate({draftId,requiredCredits,onClose}:{
 draftId:string;requiredCredits:number;onClose:()=>void;
}){
 const modal=useRef<HTMLDialogElement>(null);
 const [mode,setMode]=useState<"register"|"login">("register");
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [confirm,setConfirm]=useState("");
 const [consent,setConsent]=useState(false);
 const [googleReady,setGoogleReady]=useState(false);
 const [accountEnabled,setAccountEnabled]=useState<boolean|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const returnTo=studioAccountReturn(draftId,requiredCredits);
 useEffect(()=>{
  modal.current?.showModal();
  void fetch("/api/google-auth",{cache:"no-store",credentials:"same-origin"})
   .then(async r=>r.ok?r.json():null)
   .then(v=>setGoogleReady(v?.enabled===true)).catch(()=>setGoogleReady(false));
  void fetch("/api/customer-auth",{cache:"no-store",credentials:"same-origin"})
   .then(r=>setAccountEnabled(r.status!==403&&r.status!==503))
   .catch(()=>setAccountEnabled(false));
 },[]);
 function remember(){
  if(!returnTo||!consent)throw Error("Confirm transferring this browser's saved project first.");
  try{
   sessionStorage.setItem(STUDIO_ACCOUNT_RESUME_KEY,
    JSON.stringify({draftId,requiredCredits,created:Date.now()}));
  }catch{throw Error("This browser cannot keep the private project handoff. Enable session storage and retry.");}
 }
 async function submit(e:import("react").FormEvent){
  e.preventDefault();if(busy||!returnTo)return;
  if(mode==="register"&&password!==confirm){setError("Passwords do not match.");return;}
  setBusy(true);setError("");
  try{
   remember();
   const r=await fetch("/api/customer-auth",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:mode,email,password}),
   });
   const v=await r.json() as {error?:string;authenticated?:boolean;emailVerification?:string;verificationEmailSent?:boolean};
   if(!r.ok||v.authenticated!==true)throw Error(v.error||"Account sign-in failed.");
   // The authenticated session is established by the server. Its verified
   // ownership import and credit check happen on the return route, not here.
   // The continuation page transfers the media first and then directs
   // pending email accounts to the verification screen, not Stripe.
   window.location.assign(returnTo);
  }catch(cause){setError(cause instanceof Error?cause.message:"Sign-in unavailable.");setBusy(false);}
 }
 const googleHref=returnTo?"/api/google-auth?start=1&returnTo="+encodeURIComponent(returnTo):null;
 return <dialog ref={modal} className="product-dialog product-theme sm-confirm-simple"
  onCancel={onClose} onClose={onClose} aria-labelledby="sm-guest-account-title"
  style={{maxWidth:490,width:"calc(100vw - 28px)",maxHeight:"90dvh",overflowY:"auto"}}>
  <h2 id="sm-guest-account-title">{mode==="register"?"Create your free account":"Sign in to generate"}</h2>
  <p className="sm-confirm-notice">Account creation is <strong>free</strong>. You only buy Credits when you choose to generate a video. Your audio, photo, performance and Step 4 selection will be kept.</p>
  <p className="sm-confirm-notice">This video needs <strong>{requiredCredits.toLocaleString("en-GB")} Credits</strong>. After signing in, review your wallet and purchase Credits securely through Stripe when checkout is available. Email accounts must verify their address before purchasing Credits; Google sign-in uses Google’s verified email. You will return to Step 4 before any video is generated.</p>
  <div style={{display:"flex",gap:8,marginBottom:14}}>
   <button type="button" className="product-secondary" aria-pressed={mode==="register"}
    disabled={busy} onClick={()=>{setMode("register");setError("");}}>Create account</button>
   <button type="button" className="product-secondary" aria-pressed={mode==="login"}
    disabled={busy} onClick={()=>{setMode("login");setError("");}}>Sign in</button>
  </div>
  {accountEnabled===false&&<p role="alert" className="sm-confirm-notice">Account registration is not yet enabled on this environment. Your draft remains saved. No payment will be taken.</p>}
  <form onSubmit={e=>void submit(e)} style={{display:"grid",gap:12}}>
   <label>Email address<input type="email" autoComplete="email" required maxLength={254}
    value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
   <label>Password<input type="password" autoComplete={mode==="register"?"new-password":"current-password"}
    required minLength={mode==="register"?20:1} maxLength={256} value={password}
    onChange={e=>setPassword(e.target.value)}
    placeholder={mode==="register"?"At least 20 characters":"Your password"}/></label>
   {mode==="register"&&<label>Confirm password<input type="password" autoComplete="new-password"
    required minLength={20} maxLength={256} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
   <label className="sm-review-rights" style={{display:"flex",alignItems:"flex-start",gap:10}}>
    <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
    <span>Transfer the guest projects and uploads saved in this browser to my account. Only this browser's verified guest workspace can be transferred.</span>
   </label>
   <button type="submit" className="product-primary" disabled={busy||!consent||!returnTo||accountEnabled===false}>
    {busy?"Signing in…":mode==="register"?"Create free account & continue":"Sign in & continue"}
   </button>
  </form>
  {googleReady&&googleHref&&<div style={{marginTop:18}}>
   <p style={{textAlign:"center"}}>or</p>
   <a className="product-secondary" style={{display:"block",textAlign:"center",padding:12}}
    href={consent?googleHref:undefined} aria-disabled={!consent||busy}
    onClick={e=>{if(!consent||busy){e.preventDefault();setError("Confirm transfer of your guest project first.");return;}
     try{remember();}catch(cause){e.preventDefault();setError((cause as Error).message);}}}>
    Continue with Google
   </a>
  </div>}
  <p className="sm-confirm-notice" style={{fontSize:13}}>Payment is separate from account registration. Signing in never charges Credits or starts a provider job.</p>
  {error&&<p role="alert" className="sm-confirm-notice">{error}</p>}
  <button type="button" className="product-secondary" onClick={onClose} disabled={busy}>Back to Step 4</button>
 </dialog>;
}
