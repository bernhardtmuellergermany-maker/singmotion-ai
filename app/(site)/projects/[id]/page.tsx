import { Shell } from "@/components/shell";
import { Project } from "@/components/projects";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Shell hideWorkspaceNav>
      <Project id={(await params).id} />
    </Shell>
  );
}
