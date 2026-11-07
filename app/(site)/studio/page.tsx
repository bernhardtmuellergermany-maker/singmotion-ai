export const dynamic = "force-dynamic";
import { studioContent } from "@/cms/studio-content";
import { StudioWizard } from "@/components/studio-wizard";
export default async function Page() {
  return <StudioWizard content={await studioContent()} />;
}
