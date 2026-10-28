import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPayload } from "payload";
import config from "@payload-config";
import { studioStaff } from "@/cms/studio-access";
import { LiveProjects } from "@/components/studio-live";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (process.env.CMS_ENABLED !== "true") redirect("/operator-signin");
  const h = await headers(),
    payload = await getPayload({ config }),
    { user } = await payload.auth({ headers: h });
  try {
    studioStaff(user, "GET", h, process.env);
  } catch {
    redirect("/operator-signin");
  }
  return (
    <Shell>
      <h1>Operator controls</h1>
      <p>
        Saved generation status, private downloads and task-specific recovery.
        Historical reservations do not block new projects.
      </p>
      <LiveProjects />
    </Shell>
  );
}
