import Link from "next/link";
import { PrivateLedger } from "./private-ledger";
import { StudioActivation } from "./studio-activation";
import { FirstTestPanel } from "./first-test-panel";
import type { AdminViewServerProps } from "payload";
import { hasRole } from "../../cms/policy";
export async function Operations({ user }: Pick<AdminViewServerProps, "user">) {
  if (!hasRole(user, ["super-admin", "support"]))
    return (
      <section style={{padding:"24px",background:"var(--theme-elevation-50)",borderRadius:16}}><h2>SingMotion Content Studio</h2><p>Manage the website and publish reviewed content.</p><p><Link href="/admin/collections/pages">Website pages</Link> · <Link href="/admin/collections/cms-assets">Media library</Link> · <Link href="/admin/globals/site-navigation">Navigation</Link></p></section>
    );
  const { db } = await import("../../lib/db");
  // Deliberate projection: no owner/session tokens, filenames, URLs, prompts or media.
  const jobs = db
    .prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status")
    .all() as { status: string; count: number }[];
  const { count } = db
    .prepare(
      "SELECT COUNT(DISTINCT owner) AS count FROM sessions WHERE expires > unixepoch() * 1000",
    )
    .get() as { count: number };
  return (
    <section
      style={{
        padding: "28px",
        border: "1px solid var(--theme-elevation-200)",
        borderRadius: "18px",
        background: "var(--theme-elevation-50)",
      }}
    >
      <div style={{marginBottom: 28}}><p style={{letterSpacing:".12em",textTransform:"uppercase",fontSize:11,color:"var(--theme-elevation-600)"}}>SINGMOTION / CONTROL CENTER</p><h1 style={{fontSize:"clamp(26px,3vw,40px)",marginBottom:8}}>Your workspace</h1><p>Manage your content, review Studio activity and prepare the customer experience.</p><nav aria-label="CMS quick links" style={{display:"flex",flexWrap:"wrap",gap:12,marginTop:18}}><Link href="/admin/collections/pages" style={{padding:"12px 16px",border:"1px solid var(--theme-elevation-250)",borderRadius:12}}>Website pages</Link><Link href="/admin/collections/cms-assets" style={{padding:"12px 16px",border:"1px solid var(--theme-elevation-250)",borderRadius:12}}>Media library</Link><Link href="/admin/globals/studio-settings" style={{padding:"12px 16px",border:"1px solid var(--theme-elevation-250)",borderRadius:12}}>Studio content</Link><Link href="/admin/globals/site-navigation" style={{padding:"12px 16px",border:"1px solid var(--theme-elevation-250)",borderRadius:12}}>Navigation</Link></nav></div>
      {hasRole(user, ["super-admin"]) && (
        <>
          <h2>Private Studio operations</h2>
          <PrivateLedger user={user} />
          <p>
            <Link href="/">Open Studio</Link> ·{" "}
            <Link href="/my-videos">Projects and private downloads</Link> ·{" "}
            <Link href="/operator">Task diagnostics and recovery</Link>
          </p>
          <p>
            Private generation requires an explicitly allowlisted operator.
            Editor accounts can operate without Super Admin rights. Existing
            task IDs, cost reservations and recovery records remain in the
            private ledger.
          </p>
          <details>
            <summary>Historical pilot tools and policy maintenance</summary>
            <p>
              These tools preserve earlier test records. New Studio projects do
              not require pilot activation or daily/cumulative budget renewal.
            </p>
            <StudioActivation />
            <FirstTestPanel />
          </details>
        </>
      )}
      <h2>SingMotion operations</h2>
      <p>
        Public customer generation and payments remain disabled. Operator media,
        orders, provider task IDs and recovery are managed through the private
        Studio. CMS website assets are public content and must never contain
        private uploads.
      </p>
      <p>
        Active anonymous demo workspaces: {count}. These are not registered
        customer accounts.
      </p>
      <h3>Persisted demo jobs</h3>
      <ul>
        {jobs.map((row) => (
          <li key={row.status}>
            {row.status}: {row.count}
          </li>
        ))}
      </ul>
      <h3>Not connected</h3>
      <p>
        Verified customer payments, email delivery, invoices and public customer
        generation are not connected. The isolated customer/guest ledger and
        idempotent credit primitives are preparation only. No starting credit is
        invented.
      </p>
      <p>
        The Super Admin test panel exposes only that administrator’s private
        test plan, never customer media or another operator’s plan. Spending and
        output-host approvals remain required. Uncertain tasks cannot be
        resubmitted.
      </p>
      <p>
        Private customer files are not available here. CMS assets are separate
        public website images. Storage cleanup and infrastructure configuration
        remain server-controlled.
      </p>
    </section>
  );
}
