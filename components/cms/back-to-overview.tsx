"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {ArrowLeft} from "lucide-react";
/** Visible on every inner CMS route, including native Payload collections.
 * Never show a fake authenticated navigation action on the sign-in page.
 */
export function CmsBackToOverview(){
 const pathname=usePathname();
 if(!pathname||pathname==="/admin"||!pathname.startsWith("/admin/")||
    /^\/admin\/(login|forgot-password|reset-password|create-first-user)(\/|$)/.test(pathname))
  return null;
 return <nav className="sm-cms-back-to-overview" aria-label="CMS zurück zur Übersicht">
  <Link href="/admin"><ArrowLeft size={16} aria-hidden="true"/> Zur Übersicht</Link>
 </nav>;
}
