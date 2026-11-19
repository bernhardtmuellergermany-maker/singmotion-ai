import {cookies,headers} from "next/headers";
import {notFound} from "next/navigation";
import {SiteHeader} from "@/components/site-header";
import {MusicVideoEditor} from "@/components/music-video-editor";
import {musicPrincipal} from "@/lib/music-video/auth";
import {requireMusicProject} from "@/lib/music-video/core";
export const metadata={title:"Music Video Builder | SingMotion AI",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){
  const principal=await musicPrincipal(await headers(),(await cookies()).get("sm_customer")?.value||"");
  if(!principal)notFound();
  const {id}=await params;
  try{requireMusicProject(id,principal);}catch{notFound();}
  return <div className="product-theme sm-projects-layout"><SiteHeader/><MusicVideoEditor id={id}/></div>;
}