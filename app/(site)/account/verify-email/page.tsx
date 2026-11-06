"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Shell} from "@/components/shell";

export default function VerifyEmail(){
 const [token,setToken]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[verified,setVerified]=useState(false);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)setToken(new URLSearchParams(window.location.search).get("token")||"");});return ()=>{active=false};},[]);
 async function confirm(){
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/customer-email-verification",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirm",token})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Email verification failed");
   setVerified(true);setToken("");setMessage("Your email has been verified successfully.");
   window.history.replaceState(null,"","/account/verify-email");
  }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
 }
 return <Shell hideWorkspaceNav><main style={{maxWidth:520,margin:"64px auto",padding:28,color:"#eee8ff",background:"#171424",border:"1px solid #544070",borderRadius:16}}>
  <h1 style={{fontSize:26,marginBottom:12}}>Verify your email</h1>
  <p>{verified?"Email confirmed. Your SingMotion AI account is ready.":"Confirm your email address to unlock future paid video orders. Your current projects stay unchanged."}</p>
  {!verified&&token&&<button type="button" disabled={busy} onClick={()=>void confirm()} style={{padding:"12px 18px",border:0,borderRadius:9,background:"#9255f2",color:"#fff",cursor:"pointer"}}>{busy?"Verifying…":"Confirm email address"}</button>}
  {!verified&&!token&&<p>Open the verification link from your email. To request another link, sign in and use your account settings.</p>}
  {message&&<p role="status">{message}</p>}
  <p><Link href="/account/settings" style={{color:"#c9a6ff"}}>Account settings</Link> · <Link href="/?card=login" style={{color:"#c9a6ff"}}>Sign in</Link></p>
 </main></Shell>;
}
