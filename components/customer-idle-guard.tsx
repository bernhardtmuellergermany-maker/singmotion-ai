"use client";
import {useEffect} from "react";
import {notifyAuthTransition} from "@/lib/client";

/** Reports actual user input only. Status checks NEVER refresh inactivity. */
export function CustomerIdleGuard(){
 useEffect(()=>{
  let alive=true,hadCustomerSession=false,pending=false,reporting=false,lastReport=0,signedOut=false;
  const expired=()=>{
   if(signedOut||!alive)return;
   signedOut=true;
   notifyAuthTransition();
   window.location.assign("/login?session=expired");
  };
  const check=async()=>{
   if(!alive||pending||signedOut)return;
   pending=true;
   try{
    const response=await fetch("/api/customer-session-activity",{cache:"no-store",credentials:"same-origin"});
    if(!alive)return;
    if(response.ok)hadCustomerSession=true;
    else if(response.status===401&&hadCustomerSession)expired();
   }catch{/* An offline device cannot refresh its session or bypass the server timeout. */}
   finally{pending=false;}
  };
  const report=async()=>{
   if(!alive||!hadCustomerSession||reporting||signedOut||Date.now()-lastReport<45000)return;
   reporting=true;lastReport=Date.now();
   try{
    const response=await fetch("/api/customer-session-activity",{method:"POST",credentials:"same-origin",cache:"no-store"});
    if(alive&&response.status===401)expired();
   }catch{/* Retry only after a later real user gesture. */}
   finally{reporting=false;}
  };
  const interaction=(event:Event)=>{
   if(event.isTrusted)void report();
  };
  const visible=()=>{if(document.visibilityState==="visible")void check();};
  const focus=()=>{void check();};
  const refreshed=()=>{hadCustomerSession=false;void check();};
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
