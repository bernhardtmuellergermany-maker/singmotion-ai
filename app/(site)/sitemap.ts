import type {MetadataRoute} from "next";
import {SEO_PUBLIC_PATHS,seoPubliclyIndexable,SITE_ORIGIN} from "@/lib/seo/search-pages";

// An empty sitemap is returned in preview/staging even to authenticated staff.
export const dynamic="force-dynamic";
export default function sitemap():MetadataRoute.Sitemap{
 if(!seoPubliclyIndexable())return [];
 return SEO_PUBLIC_PATHS.map(path=>({
  url:SITE_ORIGIN+path,
  changeFrequency:"monthly" as const,
  priority:path==="/"?1:path==="/en"||path==="/de"?.8:.7
 }));
}
