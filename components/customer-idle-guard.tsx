"use client";
import {useEffect} from "react";
import {notifyAuthTransition} from "@/lib/client";

/** Reports actual user input only. Status checks NEVER refresh inactivity. */
export function CustomerIdleGuard(){
 useEffect(()=>{
  let alive=true,hadCustomerSession=false,pending=false,reporting=false,lastReport=0,signedOut=false,authRevision=0;
  const expired=()=>{
   if(signedOut||!alive)return;
   signedOut=true;
   // Customer expiry clears only customer credentials and owned media.
   // A simultaneous CMS staff session remains intact.
   void (async()=>{
    try{
     await fetch("/api/unified-logout",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      signal:AbortSignal.timeout(8000),
     });
    }catch{/* The 401 status endpoint already invalidated the customer cookies.
               Offline browsers cannot regain an expired server session. */}
    if(!alive)return;
    notifyAuthTransition();
    window.location.replace("/login?session=expired");
   })();
  };
  const check=async()=>{
   if(!alive||pending||signedOut)return;
   const revision=authRevision;
   pending=true;
   try{
    const response=await fetch("/api/customer-session-activity",{cache:"no-store",credentials:"same-origin"});
    if(!alive||revision!==authRevision)return;
    if(response.ok)hadCustomerSession=true;
    else if(response.status===401){
     const state=await response.json().catch(()=>null) as {expiredSession?:boolean}|null;
     // Also recover after browser restart: no successful GET may have occurred
     // before the account-wide timeout was enforced on another device.
     if(alive&&revision===authRevision&&(hadCustomerSession||state?.expiredSession===true))expired();
    }
   }catch{/* An offline device cannot refresh its session or bypass the server timeout. */}
   finally{pending=false;}
  };
  const report=async()=>{
   if(!alive||!hadCustomerSession||reporting||signedOut||Date.now()-lastReport<45000)return;
   const revision=authRevision;
   reporting=true;lastReport=Date.now();
   try{
    const response=await fetch("/api/customer-session-activity",{method:"POST",credentials:"same-origin",cache:"no-store"});
    if(alive&&revision===authRevision&&response.status===401)expired();
   }catch{/* Retry only after a later real user gesture. */}
   finally{reporting=false;}
  };
  const interaction=(event:Event)=>{
   if(event.isTrusted)void report();
  };
  const visible=()=>{if(document.visibilityState==="visible")void check();};
  const focus=()=>{void check();};
  const refreshed=()=>{authRevision++;hadCustomerSession=false;void check();};
  for(const name of ["pointerdown","pointermove","keydown","wheel","touchstart"])
   document.addEventListener(name,interaction,{passive:true});
  document.addEventListener("visibilitychange",visible);
  window.addEventListener("focus",focus);
  window.addEventListener("sm-auth-changed",refreshed);
  const interval=window.setInterval(()=>void check(),30000);
  void check();
  return ()=>{
   alive=false;window.clearInterval(interval);
   for(const name of ["pointerdown","pointermove","keydown","wheel","touchstart"])
    document.removeEventListener(name,interaction);
   document.removeEventListener("visibilitychange",visible);
   window.removeEventListener("focus",focus);
   window.removeEventListener("sm-auth-changed",refreshed);
  };
 },[]);
 return null;
}
