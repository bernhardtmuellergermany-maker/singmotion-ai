import type { Metadata } from "next";
import {connection} from "next/server";
import {redirect} from "next/navigation";
import {seoPrelaunchMetadataRobots} from "@/lib/seo/search-pages";
import { ImmersiveHome } from "@/components/immersive-home";
import { CarouselExperience } from "@/components/carousel-experience";
import "./home-immersive.css";
// The public carousel shell contains no server-personalized data;
// allow Next.js to cache it while private projects load client-side.
/** Runtime metadata: private Staging is noindex; public Production can be indexed. */
export async function generateMetadata():Promise<Metadata>{
  await connection();
  return {
  title: { absolute: "AI Music Video Maker from Your Song | SingMotion AI" },
  description: "Create AI singing and performance videos from your song and photo. Explore music videos, Reels, Shorts and TikTok concepts with SingMotion AI.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", siteName: "SingMotion AI", locale: "en_US", url: "/",
    title: "AI Music Video Maker | SingMotion AI",
    description: "Turn your own song and photo into a singing-performance AI music video.",
    images: [{ url: "/artwork/singmotion-stage.webp", alt: "SingMotion AI music performance" }],
  },
  twitter: { card: "summary_large_image" },
  robots: seoPrelaunchMetadataRobots(),
  };
}
export default async function Home({searchParams}:{searchParams:Promise<{card?:string}>}) {
  const params=await searchParams;
  // Existing /login redirects, account links and private project carousel
  // deep links remain supported. No changes to any authentication route.
  if(params?.card==="login")redirect("/login");
  if(typeof params?.card==="string"&&params.card.length>0)
    return <CarouselExperience />;
  return <ImmersiveHome />;
}
