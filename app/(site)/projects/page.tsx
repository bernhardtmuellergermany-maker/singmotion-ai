import {SiteHeader} from "@/components/site-header";
import {MyProjectsGallery} from "@/components/my-projects-gallery";

export const metadata={
 title:"My Projects | SingMotion AI",
 robots:{index:false,follow:false}
};
export default function Page(){
 return <div className="product-theme sm-projects-layout">
   <SiteHeader/>
   <main id="content"><MyProjectsGallery/></main>
 </div>;
}
