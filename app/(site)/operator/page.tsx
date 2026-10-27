import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPayload } from "payload";
import config from "@payload-config";
import { studioStaff } from "@/cms/studio-access";
import { Studio } from "@/components/studio";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (process.env.CMS_ENABLED !== "true") redirect("/admin/login");
  const h = await headers(),
    payload = await getPayload({ config }),
    { user } = await payload.auth({ headers: h });
  try {
    studioStaff(user, "GET", h, process.env);
  } catch {
    redirect("/admin/login");
  }
  return (
    <Shell>
      <h1>Operator controls</h1>
      <p>
        Budget review, diagnostics and legacy recovery. Public generation stays
        disabled.
      </p>
      <Studio />
    </Shell>
  );
}
