"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {UserRound} from "lucide-react";
import "./header-account-menu.css";

/** Shared account menu. Authentication is verified server-side, never inferred from cookies in JS. */
export function HeaderAccountMenu({onLoginClick}:{onLoginClick?:()=>void}){
 const menu=useRef<HTMLDetailsElement>(null);
 const [identity,setIdentity]=useState<"loading"|"guest"|"customer"|"staff">("loading");
 const [busy,setBusy]=useState(false);
 const [emailVerification,setEmailVerification]=useState<"pending"|"verified"|"legacy"|null>(null);
 const [verificationNotice,setVerificationNotice]=useState("");
 const [error,setError]=useState("");
 useEffect(()=>{
  let active=true;
  const refresh=()=>{void fetch("/api/customer-auth",{credentials:"same-origin",cache:"no-store"})
   .then(async r=>r.ok?await r.json():null)
   .then(v=>{if(active){setIdentity(v?.authenticated===true?(v.kind==="staff"?"staff":"customer"):"guest");setEmailVerification(v?.kind==="customer"&&v.authenticated===true?v.emailVerification??null:null);}})
   .catch(()=>{if(active)setIdentity("guest")})};
  refresh();
  const outside=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false};
  const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&menu.current)menu.current.open=false};
  const focus=()=>refresh();
  document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);window.addEventListener("focus",focus);
  return()=>{active=false;document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);window.removeEventListener("focus",focus)};
 },[]);
 async function resendVerification(){
  if(busy)return;
  setBusy(true);setError("");setVerificationNotice("");
  try{
   const response=await fetch("/api/customer-email-verification",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"resend"})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||"Could not resend verification email");
   setVerificationNotice(data.message||"Please check your inbox.");
  }catch(e){setError(e instanceof Error?e.message:"Could not send verification email")}
  finally{setBusy(false)}
 }
 async function logout(){
  if(busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/customer-auth",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout"})});
   if(!response.ok)throw Error("Logout failed. Please try again.");
   menu.current?.removeAttribute("open");
   window.location.assign("/");
  }catch(e){setError(e instanceof Error?e.message:"Logout failed");setBusy(false)}
 }
 return <details ref={menu} className="sm-global-menu sm-account-menu">
  <summary aria-label="Account menu" title="Account menu"><UserRound size={21}/></summary>
  <nav className="sm-global-menu-list" aria-label="Account options">
   {identity==="loading"?<span className="sm-account-menu-info">Checking login…</span>:
    identity==="guest"?<Link href="/?card=login" onClick={e=>{if(menu.current)menu.current.open=false;if(onLoginClick){e.preventDefault();onLoginClick();}}}>Login</Link>:
    <>
     <Link href="/plans" onClick={()=>{if(menu.current)menu.current.open=false}}>Upgrade</Link>
     <Link href="/account/settings" onClick={()=>{if(menu.current)menu.current.open=false}}>Account Settings</Link>
     {identity==="customer"&&emailVerification==="pending"&&<>
      <span className="sm-account-menu-info">Email not yet verified. Check your inbox before ordering videos.</span>
      <button type="button" disabled={busy} onClick={()=>void resendVerification()}>{busy?"Sending…":"Resend verification email"}</button>
     </>}
     {identity==="customer"&&emailVerification==="verified"&&<span className="sm-account-menu-info">Email verified ✓</span>}
     {identity==="customer"?<button type="button" disabled={busy} onClick={()=>void logout()}>{busy?"Logging out…":"Logout"}</button>:
      <Link href="/operator-signin" onClick={()=>{if(menu.current)menu.current.open=false}}>Staff sign-in / sign-out</Link>}
    </>}
  </nav>
  {verificationNotice&&<p className="sm-account-menu-info" role="status">{verificationNotice}</p>}
  {error&&<p className="sm-account-menu-error" role="alert">{error}</p>}
 </details>;
}
