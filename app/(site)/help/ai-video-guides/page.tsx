import type {Metadata} from "next";
import {SearchHub} from "@/components/seo/search-landing";
import {SITE_ORIGIN,SEO_GUIDES_HUB} from "@/lib/seo/search-pages";
export const metadata:Metadata={
 metadataBase:new URL(SITE_ORIGIN),
 title:{absolute:"AI Video & Music Video Guides | SingMotion AI"},
 description:"Explore how to create AI music videos, singing photos, OmniHuman performances, TikTok clips, Instagram Reels and YouTube Shorts with SingMotion AI.",
 alternates:{canonical:SEO_GUIDES_HUB},
 openGraph:{type:"website",locale:"en_US",siteName:"SingMotion AI",url:SEO_GUIDES_HUB,
  title:"AI Music Video Creation Guides | SingMotion AI",
  description:"Create AI music performances from your own song and photo.",
  images:[{url:"/artwork/singmotion-stage.webp",alt:"SingMotion AI"}]},
};
export default function Page(){return <SearchHub/>;}
