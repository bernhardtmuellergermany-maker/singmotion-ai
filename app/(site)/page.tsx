import type { Metadata } from "next";
import { ImmersiveHome } from "@/components/immersive-home";
import { CarouselExperience } from "@/components/carousel-experience";
import "./home-immersive.css";
// The public carousel shell contains no server-personalized data;
// allow Next.js to cache it while private projects load client-side.
export const metadata: Metadata = {
  title: "SingMotion AI — Your music. Your performance.",
  description: "Create a singing performance video using your own music and photo in your private SingMotion AI studio.",
  robots: process.env.RAILWAY_ENVIRONMENT_ID === "dfaeabed-03df-43ed-aa71-50f343a75041"
    ? { index: false, follow: false }
    : undefined,
};
export default async function Home({searchParams}:{searchParams:Promise<{card?:string}>}) {
  const params=await searchParams;
  // Existing /login redirects, account links and private project carousel
  // deep links remain supported. No changes to any authentication route.
  if(typeof params?.card==="string"&&params.card.length>0)
    return <CarouselExperience />;
  return <ImmersiveHome />;
}
