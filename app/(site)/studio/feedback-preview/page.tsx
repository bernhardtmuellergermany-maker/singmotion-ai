import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {SiteHeader} from "@/components/site-header";
import {FeedbackPreview} from "@/components/feedback-preview";

export const dynamic="force-dynamic";
export const metadata:Metadata={
  title:"Customer notification preview",
  robots:{index:false,follow:false,noarchive:true},
};

/** Private Staging only: this page never calls an API, charges Credits, or creates a provider job. */
export default function Page(){
  if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041")
    notFound();
  return <div className="product-theme sm-carousel-page">
    <SiteHeader/>
    <main id="content"><FeedbackPreview/></main>
  </div>;
}
