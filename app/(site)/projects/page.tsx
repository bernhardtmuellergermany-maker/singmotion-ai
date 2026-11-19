import {cookies,headers} from "next/headers";
import {notFound} from "next/navigation";
import {SiteHeader} from "@/components/site-header";
import {MusicProjectsClient} from "@/components/music-projects-client";
import {musicPrincipal} from "@/lib/music-video/auth";
export const metadata={title:"Projects | SingMotion AI",robots:{index:false,follow:false}};
export default async function Page(){
  const principal=await musicPrincipal(await headers(),(await cookies()).get("sm_customer")?.value||"");
  if(!principal)notFound();
  return <div className="product-theme sm-projects-layout"><SiteHeader/><MusicProjectsClient/></div>;
}