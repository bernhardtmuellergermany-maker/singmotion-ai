import type {Metadata} from "next";
import {SearchHub} from "@/components/seo/search-landing";
import {SITE_ORIGIN} from "@/lib/seo/search-pages";
export const metadata:Metadata={
 metadataBase:new URL(SITE_ORIGIN),
 title:{absolute:"AI Video & Music Video Maker | SingMotion AI"},
 description:"Create AI singing videos from your photo and song. Explore AI music videos, OmniHuman performances and vertical clips for TikTok, Reels and Shorts.",
 alternates:{canonical:"/en",languages:{de:"/de",en:"/en","x-default":"/en"}},
 openGraph:{type:"website",locale:"en_US",siteName:"SingMotion AI",url:"/en",
  title:"AI Music Video Maker | SingMotion AI",
  description:"Photo-and-audio AI music performances and vertical music video clips.",
  images:[{url:"/artwork/singmotion-stage.webp",alt:"SingMotion AI"}]},
};
export default function Page(){return <SearchHub locale="en"/>;}
