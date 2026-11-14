import type {Metadata} from "next";
import {SiteHeader} from "@/components/site-header";
import {StudioAccountResume} from "@/components/studio-account-resume";

export const metadata:Metadata={
 title:"Continue your video — SingMotion AI",
 robots:{index:false,follow:false},
};
export default function ContinueStudioPage(){
 return <div className="product-theme" style={{minHeight:"100dvh",background:"#070b16"}}>
  <SiteHeader/>
  <main id="content"><StudioAccountResume/></main>
 </div>;
}
