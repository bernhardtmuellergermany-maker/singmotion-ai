"use client";
import {useEffect,useState,type FormEvent} from "react";
import Link from "next/link";
import {ArrowLeft,KeyRound} from "lucide-react";
import {SiteHeader} from "@/components/site-header";
import "../../login/standalone-login.css";
import "./reset-password.css";

/** Uses the same branded standalone account layout as Sign in / Create account.
 * The reset token is supplied by the email link, never submitted in a URL. */
export default function ResetPassword(){
 const [ready,setReady]=useState(false);
 const [checking,setChecking]=useState(true);
 const [token,setToken]=useState("");
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [confirm,setConfirm]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  setToken(new URLSearchParams(window.location.search).get("token")||"");
  void fetch("/api/customer-password-reset",{cache:"no-store",signal:controller.signal})
   .then(async r=>r.ok?await r.json():null)
   .then(d=>{if(!controller.signal.aborted)setReady(d?.enabled===true);})
   .catch(()=>{})
   .finally(()=>{if(!controller.signal.aborted)setChecking(false);});
  return()=>controller.abort();
 },[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(busy)return;
  if(token&&password!==confirm){setError(true);setMessage("Passwords do not match.");return;}
  setBusy(true);setError(false);setMessage("");
  try{
   const res=await fetch("/api/customer-password-reset",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(token?{action:"confirm",token,password}:{action:"request",email})
   });
   const result=await res.json();
   if(!res.ok)throw Error(result.error||"Password reset request failed.");
   setMessage(result.message||"Check your inbox for the next step.");
   if(token){setToken("");setPassword("");setConfirm("");}
  }catch(err){setError(true);setMessage(err instanceof Error?err.message:"Please try again.");}
  finally{setBusy(false);}
 }
 return <div className="sm-standalone-auth sm-reset-password">
  <SiteHeader/>
  <main id="content" className="sm-standalone-auth-main">
   <section className="sm-standalone-auth-form sm-reset-card" aria-labelledby="sm-reset-title">
    <div className="sm-carousel-login">
     <span className="sm-carousel-song-icon" aria-hidden="true"><KeyRound size={27}/></span>
     <h1 id="sm-reset-title">{token?"Choose a new password":"Reset your password"}</h1>
     <p className="sm-account-intro">{token
      ?"Secure your private AI music-video studio with a new password."
      :"Get back to creating AI music videos. We'll send a secure reset link to your account email."}</p>
     {checking?<p className="sm-reset-muted" role="status">Checking password recovery…</p>:
      !ready?<p className="sm-reset-notice" role="status">Email password recovery isn't available right now. Contact support to regain access to your account.</p>:
      <form className="sm-account-form" onSubmit={e=>void submit(e)}>
       {token?<><label className="sm-account-label">New password
         <input type="password" required minLength={20} maxLength={256}
          autoComplete="new-password" placeholder="At least 20 characters"
          value={password} onChange={e=>setPassword(e.target.value)}/>
        </label>
        <label className="sm-account-label">Confirm new password
         <input type="password" required minLength={20} maxLength={256}
          autoComplete="new-password" placeholder="Repeat your new password"
          value={confirm} onChange={e=>setConfirm(e.target.value)}/>
        </label>
        <p className="sm-reset-hint">Use a unique password with at least 20 characters.</p></>:
        <label className="sm-account-label">Email address
         <input type="email" required maxLength={254} autoComplete="email"
          placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/>
        </label>}
       <button type="submit" className="sm-carousel-primary" disabled={busy}>
        {busy?"Processing…":token?"Set new password":"Send reset link"}
       </button>
      </form>}
     {message&&<p className={error?"sm-carousel-inline-error":"sm-reset-success"} role={error?"alert":"status"}>{message}</p>}
     <Link href="/login" className="sm-reset-back"><ArrowLeft size={16}/> Back to sign in</Link>
    </div>
   </section>
  </main>
 </div>;
}
