"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export function LegalAdminAccess(){
  const [admin,setAdmin]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;fetch("/api/staff/me",{credentials:"same-origin",cache:"no-store"}).then(r=>r.ok?r.json():null).then(data=>{if(active)setAdmin(data?.user?.role==="super-admin");}).catch(()=>{});return()=>{active=false;};},[]);
  async function logout(){
    setBusy(true);
    try{
      const res=await fetch("/api/staff/logout",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:"{}"});
      if(!res.ok)throw new Error("Logout failed");
      setAdmin(false);
      window.location.assign("/legal");
    }catch{
      setBusy(false);
      window.location.assign("/admin");
    }
  }
  return <aside className="legal-admin-access" aria-label="Administrative access">
    <span>ADMINISTRATION</span>
    {admin ? <button type="button" disabled={busy} onClick={()=>void logout()}>{busy?"Signing out…":"Super-Admin Logout"}</button> : <Link href="/admin/login">Super-Admin Login</Link>}
  </aside>;
}
