import type {MetadataRoute} from "next";
import {seoPubliclyIndexable,SITE_ORIGIN} from "@/lib/seo/search-pages";

// Evaluate every request, not the build-time Railway environment.
// Production remains password-gated until independent public release.
export const dynamic="force-dynamic";
export default function robots():MetadataRoute.Robots{
 if(!seoPubliclyIndexable())
  return {rules:[{userAgent:"*",disallow:"/"}]};
 return {
  rules:[{userAgent:"*",allow:"/",disallow:[
   "/api/","/admin/","/cms-preview/","/operator","/owner-setup",
   "/account/","/projects/","/notifications","/settings",
   "/credits","/checkout","/orders/","/studio","/login","/signin",
   "/billing","/usage","/promo-admin","/support-admin","/plans"
  ]}],
  sitemap:SITE_ORIGIN+"/sitemap.xml",
  host:SITE_ORIGIN
 };
}
