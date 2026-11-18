import {SiteHeader} from "@/components/site-header";
import {MyProjectsGallery} from "@/components/my-projects-gallery";

/** Account-owned video library. Historical /projects URLs redirect here. */
export const metadata={
 title:"Videos | SingMotion AI",
 robots:{index:false,follow:false}
};
export default function Page(){
 return <div className="product-theme sm-projects-layout">
   <SiteHeader/>
   <main id="content"><MyProjectsGallery/></main>
 </div>;
}
