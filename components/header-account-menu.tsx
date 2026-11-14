"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {UserRound,Bell} from "lucide-react";
import {creditTone} from "@/lib/commerce/credit-display";
import {readCustomerAuthStatus} from "@/lib/client-auth-status";
import {resetSession} from "@/lib/client";
import "./header-account-menu.css";

/** Shared account menu. Authentication is verified server-side, never inferred from cookies in JS. */
export function HeaderAccountMenu({onLoginClick}:{onLoginClick?:()=>void}){
 const menu=useRef<HTMLDetailsElement>(null);
 const [identity,setIdentity]=useState<"loading"|"guest"|"customer"|"staff"|"super-admin">("loading");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [availableCredits,setAvailableCredits]=useState<number|null>(null);
 const [unreadNotices,setUnreadNotices]=useState(0);
 const [creditState,setCreditState]=useState<"loading"|"ready"|"unavailable">("loading");
 useEffect(()=>{
  let active=true;
  const refresh=()=>{void readCustomerAuthStatus()
   .then(v=>{if(active){setIdentity(v?.authenticated===true?(v.kind==="staff"?(v.staffRole==="super-admin"?"super-admin":"staff"):"customer"):"guest");}})
   .catch(()=>{if(active)setIdentity("guest")})};
  refresh();
  const outside=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false};
  const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&menu.current)menu.current.open=false};
  const focus=()=>refresh();
  document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);window.addEventListener("focus",focus);
  return()=>{active=false;document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);window.removeEventListener("focus",focus)};
 },[]);
 useEffect(()=>{
  if(identity!=="customer"&&identity!=="super-admin")return;
  let active=true;
  const refresh=()=>{
   void fetch("/api/credit-balance",{cache:"no-store",credentials:"same-origin"})
    .then(async response=>{
     if(!response.ok)throw Error("Credit balance unavailable");
     const result=await response.json() as {availableCredits?:number};
     if(typeof result.availableCredits!=="number"||!Number.isSafeInteger(result.availableCredits)||result.availableCredits<0)
      throw Error("Invalid credit balance");
     if(active){setAvailableCredits(result.availableCredits!);setCreditState("ready");}
    }).catch(()=>{if(active){setAvailableCredits(null);setCreditState("unavailable");}});
  };
  const onToggle=()=>{if(menu.current?.open)refresh();};
  refresh();
  window.addEventListener("focus",refresh);
  window.addEventListener("credits-changed",refresh);
  window.addEventListener("credit-balance-updated",refresh);
  menu.current?.addEventListener("toggle",onToggle);
  const current=menu.current;
  return()=>{active=false;window.removeEventListener("focus",refresh);window.removeEventListener("credits-changed",refresh);window.removeEventListener("credit-balance-updated",refresh);current?.removeEventListener("toggle",onToggle)};
 },[identity]);
 useEffect(()=>{
  if(identity!=="customer"&&identity!=="super-admin"){setUnreadNotices(0);return;}
  let active=true;
  const refresh=()=>{void fetch("/api/notifications",{cache:"no-store",credentials:"same-origin"})
   .then(async r=>{if(!r.ok)throw Error("Unavailable");return r.json() as Promise<{unread?:number}>})
   .then(data=>{if(active)setUnreadNotices(typeof data.unread==="number"?Math.max(0,data.unread):0)})
   .catch(()=>{if(active)setUnreadNotices(0)});};
  const onToggle=()=>{if(menu.current?.open)refresh()};
  refresh();
  window.addEventListener("notifications-changed",refresh);
  window.addEventListener("focus",refresh);
  const current=menu.current;
  current?.addEventListener("toggle",onToggle);
  return()=>{active=false;window.removeEventListener("notifications-changed",refresh);window.removeEventListener("focus",refresh);current?.removeEventListener("toggle",onToggle)};
 },[identity]);
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
 async function logoutStaff(){
  if(busy)return;
  setBusy(true);setError("");
  try{
   // Payload handles the actual HTTP-only CMS auth cookie and invalidates
   // the staff session; closing the private workspace separately prevents
   // a stale cms-staff media session from surviving the sign-out.
   const staff=await fetch("/api/cms/staff/logout",{method:"POST",credentials:"same-origin",cache:"no-store"});
   if(!staff.ok)throw Error("Staff sign-out failed. Try again.");
   const media=await fetch("/api/session/logout",{method:"POST",credentials:"same-origin",cache:"no-store"});
   if(!media.ok)throw Error("Staff signed out, but private workspace sign-out failed. Please reload.");
   resetSession();
   window.location.assign("/operator-signin");
  }catch(e){setError(e instanceof Error?e.message:"Staff sign-out failed");setBusy(false)}
 }
 return <details ref={menu} className="sm-global-menu sm-account-menu">
  <summary aria-label="Account menu" title="Account menu"><UserRound size={21}/></summary>
  <nav className="sm-global-menu-list" aria-label="Account options">
   {identity==="loading"?<span className="sm-account-menu-info">Checking login…</span>:
    identity==="guest"?<>
     <Link href="/login" onClick={e=>{if(menu.current)menu.current.open=false;if(onLoginClick){e.preventDefault();onLoginClick();}}}>Login</Link>
     <Link href="/plans" onClick={()=>{if(menu.current)menu.current.open=false}}>Pricing</Link>
    </>:
    (identity==="customer"||identity==="super-admin")?<>
     <div className={`sm-account-credit-status sm-account-credit-${creditTone(creditState==="ready"?availableCredits:null)}`} role="status" aria-live="polite">
      <span>Available credits</span>
      <strong>{creditState==="ready"&&availableCredits!==null?new Intl.NumberFormat("en-GB").format(availableCredits):"—"}</strong>
      <small>{creditState==="ready"&&availableCredits!==null?(availableCredits>=1000?"Balance healthy":availableCredits>=250?"Low balance":<Link href="/credits#buy-credits" className="sm-account-topup-link" onClick={()=>{if(menu.current)menu.current.open=false}}>Top up credits</Link>):creditState==="loading"?"Checking balance…":"Balance unavailable"}</small>
     </div>
     <Link href="/credits" onClick={()=>{if(menu.current)menu.current.open=false}}>Credits</Link>
     <Link href="/notifications" className="sm-account-notifications-link" onClick={()=>{if(menu.current)menu.current.open=false}}><Bell size={16} aria-hidden="true"/> Notifications {unreadNotices>0&&<span className="sm-account-unread-count" aria-label={`${unreadNotices} unread`}>{unreadNotices>99?"99+":unreadNotices}</span>}</Link>
     <Link href="/plans" onClick={()=>{if(menu.current)menu.current.open=false}}>Pricing</Link>
     <Link href="/account/settings" onClick={()=>{if(menu.current)menu.current.open=false}}>Account Settings</Link>
     <button type="button" disabled={busy} onClick={()=>void (identity==="super-admin"?logoutStaff():logout())}>{busy?"Signing out…":"Logout"}</button>
    </>:<>
     <Link href="/plans" onClick={()=>{if(menu.current)menu.current.open=false}}>Pricing</Link>
     <Link href="/account/settings" onClick={()=>{if(menu.current)menu.current.open=false}}>Account Settings</Link>
     <button type="button" disabled={busy} onClick={()=>void logoutStaff()}>{busy?"Signing out…":"Staff logout"}</button>
    </>}
  </nav>
  {error&&<p className="sm-account-menu-error" role="alert">{error}</p>}
 </details>;
}
