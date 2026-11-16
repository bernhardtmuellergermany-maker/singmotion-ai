import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {SearchLanding} from "@/components/seo/search-landing";
import {SEO_CONTENT,SEO_TOPICS,resolveSeoTopic,seoAlternates,seoPagePath,SITE_ORIGIN} from "@/lib/seo/search-pages";

export const dynamicParams=false;
export function generateStaticParams(){return SEO_TOPICS.map(topic=>({slug:SEO_CONTENT[topic].de.slug}));}
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{
 const {slug}=await params,topic=resolveSeoTopic("de",slug);
 if(!topic)return {robots:{index:false,follow:false}};
 const page=SEO_CONTENT[topic].de;
 return {
  metadataBase:new URL(SITE_ORIGIN),title:{absolute:page.title},description:page.description,
  alternates:{canonical:seoPagePath(topic,"de"),languages:seoAlternates(topic)},
  openGraph:{type:"website",locale:"de_DE",siteName:"SingMotion AI",url:seoPagePath(topic,"de"),
   title:page.title,description:page.description,images:[{url:"/artwork/singmotion-stage.webp",alt:"SingMotion AI music performance studio"}]},
  twitter:{card:"summary_large_image",title:page.title,description:page.description}
 };
}
export default async function Page({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params,topic=resolveSeoTopic("de",slug);
 if(!topic)notFound();
 return <SearchLanding locale="de" topic={topic}/>;
}
