"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {UserRound,Bell} from "lucide-react";
import {creditTone,estimatedRemainingVideoSeconds} from "@/lib/commerce/credit-display";
import {readCustomerAuthStatus} from "@/lib/client-auth-status";
import {notifyAuthTransition} from "@/lib/client";
import "./header-account-menu.css";

/** Shared account menu. Authentication is verified server-side, never inferred from cookies in JS. */
export function HeaderAccountMenu({onLoginClick}:{onLoginClick?:()=>void}){
 const menu=useRef<HTMLDetailsElement>(null);
 const [identity,setIdentity]=useState<"loading"|"guest"|"customer"|"staff"|"super-admin">("loading");
 const [email,setEmail]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [availableCredits,setAvailableCredits]=useState<number|null>(null);
 const [creditsPerSecond,setCreditsPerSecond]=useState<number|null>(null);
 const [unreadNotices,setUnreadNotices]=useState(0);
 const [creditState,setCreditState]=useState<"loading"|"ready"|"unavailable">("loading");
 useEffect(()=>{
  let active=true;
  const refresh=()=>{void readCustomerAuthStatus()
   .then(v=>{
    if(!active)return;
    const authenticated=v?.authenticated===true;
    const verifiedEmail=typeof v?.email==="string"&&v.email.includes("@")?v.email:null;
    setIdentity(authenticated?(v.kind==="staff"?(v.staffRole==="super-admin"?"super-admin":"staff"):"customer"):"guest");
    setEmail(authenticated?verifiedEmail:null);
   })
   .catch(()=>{if(active){setIdentity("guest");setEmail(null);}})};
  refresh();
  const outside=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false};
  const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&menu.current)menu.current.open=false};
  const focus=()=>refresh();
  const onToggle=()=>{if(menu.current?.open)refresh()};
  const current=menu.current;
  document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
  window.addEventListener("focus",focus);window.addEventListener("sm-auth-changed",refresh);
  current?.addEventListener("toggle",onToggle);
  return()=>{
   active=false;document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);
   window.removeEventListener("focus",focus);window.removeEventListener("sm-auth-changed",refresh);
   current?.removeEventListener("toggle",onToggle);
  };
 },[]);
 useEffect(()=>{
  if(identity!=="customer"&&identity!=="super-admin"){
   setAvailableCredits(null);setCreditsPerSecond(null);setCreditState("loading");return;
  }
  let active=true,inFlight=false,queued=false;
  // Clear verified values only when the signed-in account changes, not on every refresh.
  setAvailableCredits(null);setCreditsPerSecond(null);setCreditState("loading");
  const refresh=()=>{
   // Coalesce focus/menu/credit events instead of discarding an almost-complete response.
   if(inFlight){queued=true;return;}
   inFlight=true;
   // One small authenticated response contains both the spendable balance and live campaign rate.
   void fetch("/api/account-credit-summary",{cache:"no-store",credentials:"same-origin"})
    .then(async response=>{
     if(!response.ok)throw Error("Account credit summary unavailable");
     const result=await response.json() as {
      availableCredits?:number;creditsPerSecond?:number;expiresUtc?:number|null
     };
     if(!Number.isSafeInteger(result.availableCredits)||result.availableCredits===undefined||result.availableCredits<0||
        !Number.isSafeInteger(result.creditsPerSecond)||result.creditsPerSecond===undefined||
        result.creditsPerSecond<1||result.creditsPerSecond>1000||
        (result.expiresUtc!==null&&result.expiresUtc!==undefined&&
         (!Number.isSafeInteger(result.expiresUtc)||result.expiresUtc<=Date.now())))
      throw Error("Invalid or expired account credit summary");
     if(active){
      setAvailableCredits(result.availableCredits);
      setCreditsPerSecond(result.creditsPerSecond);
      setCreditState("ready");
     }
    }).catch(()=>{if(active){setAvailableCredits(null);setCreditsPerSecond(null);setCreditState("unavailable");}})
    .finally(()=>{inFlight=false;if(active&&queued){queued=false;refresh();}});
  };
  const onToggle=()=>{if(menu.current?.open)refresh();};
  const onVisible=()=>{if(document.visibilityState==="visible")refresh();};
  refresh();
  window.addEventListener("focus",refresh);
  window.addEventListener("credits-changed",refresh);
  window.addEventListener("credit-balance-updated",refresh);
  document.addEventListener("visibilitychange",onVisible);
  const interval=window.setInterval(()=>{if(document.visibilityState==="visible")refresh()},60_000);
  menu.current?.addEventListener("toggle",onToggle);
  const current=menu.current;
  return()=>{active=false;window.clearInterval(interval);window.removeEventListener("focus",refresh);window.removeEventListener("credits-changed",refresh);window.removeEventListener("credit-balance-updated",refresh);document.removeEventListener("visibilitychange",onVisible);current?.removeEventListener("toggle",onToggle)};
 },[identity,email]);
 useEffect(()=>{
  if(identity!=="customer"&&identity!=="super-admin"){setUnreadNotices(0);return;}
  let active=true;
  const refresh=()=>{void fetch("/api/notifications",{cache:"no-store",credentials:"same-origin"})
   .then(async r=>{if(!r.ok)throw Error("Unavailable");return r.json() as Promise<{unread?:number}>})
   .then(data=>{if(active)setUnreadNotices(typeof data.unread==="number"&&Number.isFinite(data.unread)?Math.max(0,data.unread):0)})
   .catch(()=>{if(active)setUnreadNotices(0)});};
  const onToggle=()=>{if(menu.current?.open)refresh()};
  refresh();
  window.addEventListener("notifications-changed",refresh);
  window.addEventListener("focus",refresh);
  const current=menu.current;
  current?.addEventListener("toggle",onToggle);
  // Refresh while signed in so any new unread notification appears without a reload.
  const interval=window.setInterval(()=>{if(document.visibilityState==="visible")refresh()},45_000);
  return()=>{active=false;window.clearInterval(interval);window.removeEventListener("notifications-changed",refresh);window.removeEventListener("focus",refresh);current?.removeEventListener("toggle",onToggle)};
 },[identity]);
 async function logout(){
  if(busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/unified-logout",{method:"POST",credentials:"same-origin",cache:"no-store"});
   if(!response.ok)throw Error("Sign out failed. Please retry.");
   notifyAuthTransition();
   menu.current?.removeAttribute("open");
   window.location.assign("/");
  }catch(e){setError(e instanceof Error?e.message:"Sign out failed");setBusy(false)}
 }
 async function logoutStaff(){
  if(busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/cms/staff/logout",{
    method:"POST",headers:{"Content-Type":"application/json"},body:"{}",
    credentials:"same-origin",cache:"no-store"
   });
   if(!response.ok)throw Error("CMS sign out failed. Please retry.");
   notifyAuthTransition();menu.current?.removeAttribute("open");window.location.assign("/");
  }catch(e){setError(e instanceof Error?e.message:"CMS sign out failed");setBusy(false)}
 }
 const remainingSeconds=estimatedRemainingVideoSeconds(
  creditState==="ready"?availableCredits:null,creditsPerSecond);
 return <details ref={menu} className="sm-global-menu sm-account-menu">
  <summary aria-label={unreadNotices>0?`Account menu, ${unreadNotices} unread notifications`:"Account menu"} title="Account menu"><UserRound size={21}/>{unreadNotices>0&&<span className="sm-account-gift-badge" aria-hidden="true">{unreadNotices>9?"9+":unreadNotices}</span>}</summary>
  <nav className="sm-global-menu-list" aria-label="Account options">
   {email&&(identity==="customer"||identity==="super-admin"||identity==="staff")&&
    <div className="sm-account-signed-in">
     <span>Signed in as</span>
     <strong title={email}>{email}</strong>
    </div>}
   {identity==="loading"?<span className="sm-account-menu-info">Checking login…</span>:
    identity==="guest"?<>
     <Link href="/login" onClick={e=>{if(menu.current)menu.current.open=false;if(onLoginClick){e.preventDefault();onLoginClick();}}}>Login</Link>
     <Link href="/plans" onClick={()=>{if(menu.current)menu.current.open=false}}>Pricing</Link>
    </>:
    (identity==="customer"||identity==="super-admin")?<>
     <div className={`sm-account-credit-status sm-account-credit-${creditTone(creditState==="ready"?availableCredits:null)}`} role="status" aria-live="polite">
      <span>Available credits</span>
      <div className="sm-account-credit-amount">
       <strong className="sm-account-credit-value">{creditState==="ready"&&availableCredits!==null?new Intl.NumberFormat("en-GB").format(availableCredits):"—"}</strong>
       {remainingSeconds!==null&&<span className="sm-account-credit-seconds"
         title={creditsPerSecond+" Credits per started video second"}>
         ≈ {new Intl.NumberFormat("en-GB").format(remainingSeconds)} s left
       </span>}
      </div>
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
