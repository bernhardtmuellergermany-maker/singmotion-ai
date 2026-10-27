export const dynamic = "force-dynamic";
import { studioContent } from "@/cms/studio-content";
import { StudioWizard } from "@/components/studio-wizard";

export const metadata = {
  title: "Create your music video · SingMotion AI",
  description: "Upload music, choose a photo, and create your AI music video.",
};

export default async function Home() {
  return <StudioWizard content={await studioContent()} />;
}
