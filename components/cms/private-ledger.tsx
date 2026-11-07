import "server-only";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { hasRole } from "../../cms/policy";

type LedgerRow = {
  id: string;
  task: string | null;
  state: string;
  reserved: number;
};

/** Admin-only projection. Opening this view never creates or rewrites a ledger. */
export function PrivateLedger({ user }: { user: unknown }) {
  if (!hasRole(user, ["super-admin"])) return null;
  const file = path.join(process.env.DATA_DIR || ".data", "live-test.sqlite");
  if (!existsSync(file)) return <p>No private generation ledger exists yet.</p>;
  let db: DatabaseSync | undefined;
  let rows: LedgerRow[] | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    rows = db
      .prepare(
        `SELECT id, json_extract(data,'$.providerJobId') AS task,
      json_extract(data,'$.state') AS state, reserved_micro_usd AS reserved
      FROM live_attempts ORDER BY rowid DESC LIMIT 100`,
      )
      .all() as LedgerRow[];
  } catch {
    /* No paths or raw database errors reach the admin view. */
  } finally {
    db?.close();
  }
  if (!rows)
    return (
      <p>
        Private ledger unavailable. Preserve the database and inspect server
        diagnostics.
      </p>
    );
  return (
    <section aria-label="Private generation ledger">
      <h3>Generation history and cost reservations</h3>
      <p>
        Latest 100 tasks. Reservations are retained accounting records, not
        confirmed invoices or spending limits. Private media is available only
        through its owner’s project and download routes.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Provider task</th>
              <th>Status</th>
              <th>Reserved USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.task || "Not assigned"}</td>
                <td>{row.state}</td>
                <td>{(row.reserved / 1000000).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
