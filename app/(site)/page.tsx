import { StudioWizard } from "@/components/studio-wizard";

export const metadata = {
  title: "Create your music video · SingMotion AI",
  description: "Upload music, choose a photo, and create your AI music video.",
};

export default function Home() {
  return <StudioWizard />;
}
