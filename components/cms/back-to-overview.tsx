"use client";
import {useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {ArrowLeft, LogOut} from "lucide-react";
/** CMS navigation stays independent of customer login and logout. */
export function CmsBackToOverview(){
 const pathname=usePathname();
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const cmsPage=pathname==="/admin"||pathname?.startsWith("/admin/");
 const authPage=/^\/admin\/(login|forgot-password|reset-password|create-first-user)(\/|$)/.test(pathname||"");
 if(!cmsPage||authPage)return null;
 async function logout(){
  if(busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/cms/staff/logout",{
    method:"POST",headers:{"Content-Type":"application/json"},body:"{}",
    credentials:"same-origin",cache:"no-store"
   });
   if(!response.ok)throw Error("CMS-Abmeldung fehlgeschlagen.");
   window.location.assign("/admin/login");
  }catch(cause){
   setError(cause instanceof Error?cause.message:"Abmeldung fehlgeschlagen.");
   setBusy(false);
  }
 }
 return <nav className="sm-cms-back-to-overview" aria-label="CMS Navigation">
  {pathname!=="/admin"&&<Link href="/admin"><ArrowLeft size={16} aria-hidden="true"/> Zur Übersicht</Link>}
  <button type="button" onClick={()=>void logout()} disabled={busy}>
   <LogOut size={16} aria-hidden="true"/>{busy?"Abmeldung…":"CMS abmelden"}
  </button>
  {error&&<span role="alert">{error}</span>}
 </nav>;
}
