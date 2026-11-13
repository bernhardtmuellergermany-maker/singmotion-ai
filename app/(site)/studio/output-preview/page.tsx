import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {SiteHeader} from "@/components/site-header";
import {FeedbackPreview} from "@/components/feedback-preview";

export const dynamic="force-dynamic";
export const metadata:Metadata={
  title:"Output page status preview — SingMotion AI",
  robots:{index:false,follow:false,noarchive:true},
};

/** Read-only demonstration. Never expose the simulated Output page outside private staging. */
export default function Page(){
  if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041")
    notFound();
  return <div className="product-theme sm-carousel-page">
    <SiteHeader/>
    <main id="content"><FeedbackPreview/></main>
  </div>;
}
