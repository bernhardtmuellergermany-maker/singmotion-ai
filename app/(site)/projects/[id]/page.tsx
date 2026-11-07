import { Shell } from "@/components/shell";
import { Project } from "@/components/projects";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Shell hideWorkspaceNav projectId={id}>
      <Project id={id} />
    </Shell>
  );
}
