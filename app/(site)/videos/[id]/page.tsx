import { Shell } from "@/components/shell";
import { Project } from "@/components/projects";

/** Keep the same server-side ownership checks as the previous detail route. */
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
