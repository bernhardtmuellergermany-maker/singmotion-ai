import type { Metadata } from "next";
import { CarouselExperience } from "@/components/carousel-experience";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "SingMotion AI — Your music. Your performance.",
  description: "Create a singing performance video using your own music and photo in your private SingMotion AI studio.",
  robots: process.env.RAILWAY_ENVIRONMENT_ID === "dfaeabed-03df-43ed-aa71-50f343a75041"
    ? { index: false, follow: false }
    : undefined,
};
export default function Home() { return <CarouselExperience />; }
