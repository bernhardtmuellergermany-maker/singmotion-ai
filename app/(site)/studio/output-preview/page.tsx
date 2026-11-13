import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {headers} from "next/headers";
import {getPayload} from "payload";
import config from "@payload-config";
import {hasRole} from "@/cms/policy";
import {SiteHeader} from "@/components/site-header";
import {FeedbackPreview} from "@/components/feedback-preview";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const metadata:Metadata={
  title:"Output page status preview — SingMotion AI",
  robots:{index:false,follow:false,noarchive:true},
};

/** Read-only demonstration. Require verified CMS Super Admin as well as private staging. */
export default async function Page(){
  if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041" || process.env.CMS_ENABLED!=="true")
    notFound();
  let allowed=false;
  try{
    const payload=await getPayload({config});
    const {user}=await payload.auth({headers:await headers()});
    allowed=hasRole(user,["super-admin"]);
  }catch{/* No session or unavailable CMS: fail closed. */}
  if(!allowed)notFound();
  return <div className="product-theme sm-carousel-page">
    <SiteHeader/>
    <main id="content"><FeedbackPreview/></main>
  </div>;
}
