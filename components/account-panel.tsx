"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {UserRound,Eye,EyeOff} from "lucide-react";
import {readCustomerAuthStatus} from "@/lib/client-auth-status";
import {AccountCreditSummary} from "@/components/account-credit-summary";
import {notifyAuthTransition} from "@/lib/client";
import {parseStudioAccountReturn,STUDIO_ACCOUNT_RESUME_KEY} from "@/lib/studio-account-handoff";

/** Return URLs only select an already-saved guest project. They do NOT
 * authorize access; the continuation verifies owner-bound HttpOnly cookies.
 */
function pendingStudioReturn():string|null{
 if(typeof window==="undefined")return null;
 const candidate=new URLSearchParams(window.location.search).get("returnTo");
 const verified=parseStudioAccountReturn(candidate);
 if(!verified||!candidate)return null;
 try{
  const stored=JSON.parse(sessionStorage.getItem(STUDIO_ACCOUNT_RESUME_KEY)||"null") as {
   draftId?:string;requiredCredits?:number;created?:number
  }|null;
  if(!stored||stored.draftId!==verified.draftId||
     stored.requiredCredits!==verified.requiredCredits||
     typeof stored.created!=="number"||!Number.isFinite(stored.created)||
     Date.now()-stored.created<0||Date.now()-stored.created>2*60*60*1000)return null;
  return candidate;
 }catch{return null}
}

export function AccountPanel({active}:{active:boolean}){
 const [passwordOpen,setPasswordOpen]=useState(false),[currentPassword,setCurrentPassword]=useState(""),[newPassword,setNewPassword]=useState(""),[passwordMessage,setPasswordMessage]=useState("");
 async function changePassword(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setPasswordMessage("");
  try{
   const res=await fetch("/api/customer-auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"change-password",password:currentPassword,newPassword})});
   const data=await res.json();if(!res.ok)throw Error(data.error||"Password change failed");
   setCurrentPassword("");setNewPassword("");setPasswordOpen(false);setPasswordMessage("Password updated. Other sessions were signed out.");
  }catch(err){setPasswordMessage((err as Error).message)}finally{setBusy(false)}
 }
 const [confirmPassword,setConfirmPassword]=useState(""),[showPassword,setShowPassword]=useState(false);
 const [googleAvailable,setGoogleAvailable]=useState(false);
 const [deletionComplete,setDeletionComplete]=useState(false);
 const [studioReturn,setStudioReturn]=useState<string|null>(null);

 const [staff,setStaff]=useState(false),[superAdmin,setSuperAdmin]=useState(false); const [mode,setMode]=useState<"login"|"register">("login"),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[account,setAccount]=useState<string|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!active)return;setStudioReturn(pendingStudioReturn());fetch("/api/google-auth",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>setGoogleAvailable(d?.enabled===true)).catch(()=>{});const search=new URLSearchParams(window.location.search);
  const reason=search.get("google_error");
  const expired=search.get("session")==="expired";
  if(reason)void Promise.resolve().then(()=>setError(reason.slice(0,240)));
  else if(expired)void Promise.resolve().then(()=>setError("You were signed out after inactivity. Please sign in again."));
  // OAuth failure is a one-time notice. Remove it from the address bar after
  // rendering so a refresh cannot present a stale error to the next customer.
  if(reason)search.delete("google_error");
  if(expired)search.delete("session");
  const removed=search.get("account_deleted")==="1";
  if(removed)void Promise.resolve().then(()=>setDeletionComplete(true));
  if(removed)search.delete("account_deleted");
  const changed=search.has("auth_changed");
  if(changed)search.delete("auth_changed");
  if(reason||expired||changed||removed)
   window.history.replaceState(null,"",window.location.pathname+(search.toString()?"?"+search.toString():"")+window.location.hash);
  if(changed)notifyAuthTransition();
 },[active]);
 useEffect(()=>{
  if(!active)return;
  let live=true;
  let lastCheck=0;
  const refresh=()=>{
   if(document.visibilityState==="hidden")return;
   const now=Date.now();
   if(now-lastCheck<1500)return;
   lastCheck=now;
   void readCustomerAuthStatus()
    .then(d=>{if(!live)return;
     // An expired cookie or a failed identity verification must never leave
     // the old email and its account actions rendered on the login page.
     setAccount(d?.authenticated===true?d.email??null:null);
     setStaff(d?.authenticated===true&&d.kind==="staff");
     setSuperAdmin(d?.authenticated===true&&d.kind==="staff"&&d.staffRole==="super-admin");
    });
  };
  refresh();
  const changed=()=>{
   // Clear stale account controls synchronously when the idle guard or
   // another authenticated action broadcasts that the principal changed.
   setAccount(null);setStaff(false);setSuperAdmin(false);
   lastCheck=0;refresh();
  };
  window.addEventListener("focus",refresh);
  document.addEventListener("visibilitychange",refresh);
  window.addEventListener("pageshow",refresh);
  window.addEventListener("sm-auth-changed",changed);
  return()=>{live=false;window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);window.removeEventListener("pageshow",refresh);window.removeEventListener("sm-auth-changed",changed)};
 },[active]);
 async function logoutAll(){
  if(!window.confirm("Sign out this account on all devices?"))return;
  setBusy(true);setError("");
  try{
   const res=await fetch("/api/customer-auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout-all"})});
   if(!res.ok)throw Error("Could not sign out all sessions");
   window.location.reload();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function act(action:"login"|"register"|"logout"){
  if(action==="register" && (password!==confirmPassword)){setError("Passwords do not match.");return;}
  setBusy(true);setError("");
  try{
   if(action==="logout"){
    const reply=await fetch("/api/unified-logout",{method:"POST",credentials:"same-origin"});
    if(!reply.ok)throw Error("Sign out failed");
    notifyAuthTransition();setAccount(null);window.location.reload();return;
   }
   const res=await fetch("/api/customer-auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,email,password})});
   const d=await res.json();
   if(!res.ok){
    if(action==="login" && [401,403,503].includes(res.status)){
     const staffRes=await fetch("/api/cms/staff/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
     if(staffRes.ok){notifyAuthTransition();setPassword("");window.location.reload();return;}
    }
    throw Error(d.error||"Sign-in failed");
   }
   notifyAuthTransition();setPassword("");setAccount(d.email);
   const target=pendingStudioReturn();
   if(target){window.location.assign(target);return;}
   window.location.reload();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="sm-carousel-login" data-mode={mode}>
  <span className="sm-carousel-song-icon"><UserRound size={27}/></span>
  <h1>{account?"Your account":mode==="login"?"Sign in":"Create your account"}</h1>
  {deletionComplete&&<p className="sm-account-intro" role="status">Your customer account and login sessions were deleted. You can create a new account whenever you choose.</p>}
  {!account&&studioReturn&&<p className="sm-account-intro" role="status">Your video project is saved. Sign in or create an account to return to Step 4 with your audio, photo and settings.</p>}
  {!account&&!studioReturn&&<p className="sm-account-intro">{mode==="register"
   ?"Build your private AI music-video workspace. Save drafts, create performances and keep every generation in one place."
   :"Sign in to bring your music to life with AI-generated videos. Your studio, projects and Credits are ready."}</p>}
  {error&&<p className="sm-carousel-inline-error" role="alert" aria-live="assertive">{error}</p>}
  {account?<div className="sm-account-signed-in">
    <p className="sm-account-email">{account}</p>
    <AccountCreditSummary active={active} staff={staff} superAdmin={superAdmin}/>
    <div className="sm-account-quick-actions">
      <Link href="/credits#buy-credits" className="sm-account-action sm-account-action-buy">Buy Credits</Link>
      <Link href="/studio?new=1" className="sm-account-action sm-account-action-create">Create video</Link>
      <Link href="/account/settings" className="sm-account-settings-link">Account settings</Link>
      <button type="button" className="sm-account-signout" disabled={busy} onClick={()=>void act("logout")}>Sign out</button>
    </div>
    {!staff&&<details className="sm-account-advanced">
      <summary>More account options</summary>
      <div className="sm-account-advanced-actions">
        <button type="button" disabled={busy} onClick={()=>setPasswordOpen(!passwordOpen)}>Change password</button>
        {passwordOpen&&<form onSubmit={e=>void changePassword(e)} style={{display:"grid",gap:8}}>
          <input type="password" aria-label="Current password" required autoComplete="current-password" placeholder="Current password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/>
          <input type="password" aria-label="New password" required minLength={8} maxLength={256} autoComplete="new-password" placeholder="New password (8+ characters)" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
          <button disabled={busy} type="submit">Save new password</button>
        </form>}
        {passwordMessage&&<p role="status">{passwordMessage}</p>}
        <button type="button" className="sm-account-signout-all" disabled={busy} onClick={()=>void logoutAll()}>Sign out on all devices</button>
      </div>
    </details>}
  </div>:
  <form onSubmit={e=>{e.preventDefault();void act(mode)}} className="sm-account-form">
   <label className="sm-account-label">Email address<input aria-label="Email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" maxLength={254}/></label>
   <label className="sm-account-label">Password<span className="sm-account-password-wrap"><input aria-label="Password" type={showPassword?"text":"password"} required minLength={mode==="register"?8:1} autoComplete={mode==="register"?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="register"?"At least 8 characters":"Your password"} maxLength={256}/><button type="button" className="sm-account-eye" aria-label={showPassword?"Hide password":"Show password"} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></span></label>
   {mode==="register"&&<><label className="sm-account-label">Confirm password<span className="sm-account-password-wrap"><input type={showPassword?"text":"password"} aria-label="Confirm password" required minLength={8} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Repeat your password"/><button type="button" className="sm-account-eye" aria-label={showPassword?"Hide password":"Show password"} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></span></label><p className="sm-account-hint">Use at least 8 characters. Your projects remain private to your account.</p></>}
   {mode==="login"&&<Link className="sm-account-recovery-link" href="/account/reset-password">Forgot password?</Link>}
   <button type="submit" className="sm-carousel-primary" disabled={busy}>{busy?"Working…":mode==="login"?"Sign in":"Create account"}</button>
   {googleAvailable&&<><div className="sm-account-divider"><span>or</span></div><Link className="sm-account-google" href={studioReturn?"/api/google-auth?start=1&returnTo="+encodeURIComponent(studioReturn):"/api/google-auth?start=1"}><span aria-hidden="true" className="sm-google-g">G</span>Continue with Google</Link></>}
   <button type="button" onClick={()=>{setMode(mode==="login"?"register":"login");setConfirmPassword("");setError("")}} style={{border:0,background:"transparent",color:"#d4c1ef",cursor:"pointer"}}>{mode==="login"?"Create account":"Back to sign in"}</button>
  </form>}
 </div>;
}
