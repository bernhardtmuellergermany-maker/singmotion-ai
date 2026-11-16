import type {Metadata} from "next";
import {SearchHub} from "@/components/seo/search-landing";
import {SITE_ORIGIN} from "@/lib/seo/search-pages";
export const metadata:Metadata={
 metadataBase:new URL(SITE_ORIGIN),
 title:{absolute:"KI Video erstellen: Musikvideo, Reels & OmniHuman | SingMotion AI"},
 description:"KI Video Generator für eigene Musik und Fotos: singende Portraits, KI Musikvideos, OmniHuman-Performance sowie 9:16-Clips für Reels, Shorts und TikTok.",
 alternates:{canonical:"/de",languages:{de:"/de",en:"/en","x-default":"/en"}},
 openGraph:{type:"website",locale:"de_DE",siteName:"SingMotion AI",url:"/de",
  title:"KI-Video und KI-Musikvideo erstellen | SingMotion AI",
  description:"Singende Portraits und KI-Musikvideos aus deinem eigenen Song und Foto.",
  images:[{url:"/artwork/singmotion-stage.webp",alt:"SingMotion AI"}]},
};
export default function Page(){return <SearchHub locale="de"/>;}
