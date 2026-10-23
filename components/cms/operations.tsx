import type { AdminViewServerProps } from "payload";
import { hasRole } from "../../cms/policy";
export async function Operations({ user }: Pick<AdminViewServerProps, "user">) {
  if (!hasRole(user, ["super-admin", "support"]))
    return (
      <p>
        Website editing: use Pages, CMS assets and Site navigation. Publish only
        reviewed content.
      </p>
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
        padding: "24px",
        border: "1px solid var(--theme-elevation-150)",
      }}
    >
      <h2>SingMotion operations</h2>
      <p>
        Demo mode. Public paid generation, Stripe and browser-based BytePlus
        submissions remain disabled.
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
        Customer accounts, suspension, subscriptions, real credits, payments,
        revenue, margins and refunds. Support cases record requests only. No
        invented financial balances.
      </p>
      <p>
        The private BytePlus operator ledger is intentionally not exposed
        through this dashboard. Reviewed spending and output-host approvals
        remain required in the existing operator workflow. No CMS action can
        submit, cancel or retry a provider task.
      </p>
      <p>
        Private customer files are not available here. CMS assets are separate
        public website images. Storage cleanup and infrastructure configuration
        remain server-controlled.
      </p>
    </section>
  );
}
