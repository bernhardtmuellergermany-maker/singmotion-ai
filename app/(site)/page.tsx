export const dynamic = "force-dynamic";
import { HomeCollection } from "@/components/home-collection";
export const metadata = {
  title: "Your projects · SingMotion AI",
  description: "Your own private music video projects.",
};
export default function Home() { return <HomeCollection />; }
