"use client";
import {useEffect,useState} from "react";
import type {FormEvent} from "react";
import Link from "next/link";
import {notifyAuthTransition} from "@/lib/client";
export function StagingStaffSignIn(){
 const [email,setEmail]=useState(""),[password,setPassword]=useState("");
 const [active,setActive]=useState(false),[checking,setChecking]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{
  let live=true;
  void fetch("/api/staff-website-session",{cache:"no-store",credentials:"same-origin"})
   .then(r=>r.ok?r.json():null)
   .then(d=>{if(live)setActive(d?.authenticated===true&&d.kind==="staff");})
   .catch(()=>{}).finally(()=>{if(live)setChecking(false)});
  return()=>{live=false};
 },[]);
 async function login(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  setBusy(true);setError("");
  try{
   const result=await fetch("/api/cms/staff/login",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})
   });
   if(!result.ok)throw Error(result.status===429?"Zu viele Anmeldeversuche. Bitte später erneut versuchen.":"CMS-Zugangsdaten nicht erkannt.");
   const identity=await fetch("/api/staff-website-session",{cache:"no-store",credentials:"same-origin"});
   const data=identity.ok?await identity.json():null;
   if(data?.authenticated!==true||data.kind!=="staff"||data.staffRole!=="super-admin")
    throw Error("Nur verifizierte CMS Super Admins können diesen Staging-Zugang nutzen.");
   setPassword("");notifyAuthTransition();
   window.location.assign("/studio?new=1");
  }catch(e){setError(e instanceof Error?e.message:"Anmeldung fehlgeschlagen.");setBusy(false);}
 }
 return <div className="sm-carousel-login">
  <h1>Super Admin · Staging</h1>
  <p className="sm-account-intro">Melde dich mit deinem bestehenden CMS-Konto an. Dein Kundenkonto bleibt separat.</p>
  {checking?<p role="status">CMS-Sitzung wird geprüft…</p>:active?
   <div className="sm-account-quick-actions">
    <p>Du bist bereits im Staging-CMS angemeldet.</p>
    <Link className="sm-carousel-primary" href="/studio?new=1">Studio öffnen</Link>
    <Link href="/admin">CMS öffnen</Link>
   </div>:
   <form className="sm-account-form" onSubmit={e=>void login(e)}>
    <label className="sm-account-label">CMS E-Mail
     <input aria-label="CMS E-Mail" type="email" required maxLength={254} autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label className="sm-account-label">CMS Passwort
     <input aria-label="CMS Passwort" type="password" required maxLength={256} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <button className="sm-carousel-primary" type="submit" disabled={busy}>{busy?"Anmeldung läuft…":"Mit CMS-Konto anmelden"}</button>
   </form>}
  {error&&<p role="alert" className="sm-carousel-inline-error">{error}</p>}
  <p><Link href="/login" style={{color:"#dfc8ff"}}>Zur Kundenanmeldung</Link></p>
 </div>;
}
