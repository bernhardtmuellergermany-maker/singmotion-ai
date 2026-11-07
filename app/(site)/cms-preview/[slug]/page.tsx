import Link from "next/link";
import {notFound} from "next/navigation";
import {publishedPage} from "@/cms/content";
import {Website} from "@/components/cms/website";
import {CarouselExperience} from "@/components/carousel-experience";
import "../preview.css";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false}};
export default async function Preview({params}:{params:Promise<{slug:string}>}){
 const page=await publishedPage((await params).slug,true);
 if(!page)notFound();
 if(page.slug==="home"){
  // Use the current customer-facing carousel for preview, without publishing
  // or replacing the live homepage. Only trusted CMS hero copy is projected.
  const hero=page.blocks?.find(block=>block.blockType==="hero");
  const heading=hero?.heading?.trim(),body=hero?.body?.trim();
  const homeCopy=heading&&body?{heading,body}:undefined;
  return <>
   <div className="sm-cms-preview-banner" role="status">
    <span className="sm-cms-preview-label">CMS PREVIEW</span>
    <span className="sm-cms-preview-copy">Modern homepage preview · editorial changes are not automatically live</span>
    <Link href="/admin/collections/pages" className="sm-cms-preview-back">Back to pages</Link>
   </div>
   <CarouselExperience homeCopy={homeCopy}/>
  </>;
 }
 return <Website page={page} preview/>;
}
