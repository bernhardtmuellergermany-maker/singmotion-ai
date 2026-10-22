import { cookies } from "next/headers";
import { session } from "@/lib/db";
import { Brand } from "@/components/brand";
import { Admin } from "@/components/admin";
export const dynamic = "force-dynamic";
export default async function Page() {
  const enabled =
    process.env.NODE_ENV !== "production" &&
    process.env.ADMIN_DEMO_ENABLED === "true" &&
    !!process.env.ADMIN_DEMO_ACCESS_KEY;
  if (!enabled)
    return (
      <div id="content" className="info-page">
        <Brand />
        <h1>Administrator access is disabled.</h1>
        <p>
          The private console is locked by default and always disabled in
          production in v0.1. Supabase authorization, MFA, policies, and audit
          testing must be completed before live access.
        </p>
      </div>
    );
  const auth = session((await cookies()).get("sm_session")?.value);
  return (
    <div id="content" className="info-page" style={{ maxWidth: 1150 }}>
      <Brand />
      <Admin authorized={!!auth?.admin} />
    </div>
  );
}
