"use client";
import { useState } from "react";
import { api, ensureSession } from "@/lib/client";
const sections = [
  "Overview",
  "Customers",
  "Generations",
  "Artists & assets",
  "Payments",
  "Credits",
  "Pricing",
  "Provider usage & costs",
  "System health",
  "Settings",
  "Audit log",
];
const data: Record<string, [string, string][]> = {
  Overview: [
    ["Demo customer accounts", "12 — illustrative"],
    ["Completed jobs", "28 — illustrative"],
    ["Financial actions", "Disabled"],
  ],
  Customers: [
    ["Example customer", "Demo Creator"],
    ["Account status", "Active — illustrative"],
    ["Search / suspend customer", "Disabled until backend activation"],
  ],
  Generations: [
    ["Example generation", "Completed — simulated"],
    ["Example failed job", "Technical failure — demo credits restored"],
    ["Retries", "Explicit new request only; no automatic paid retry"],
  ],
  "Artists & assets": [
    ["Example artist", "Demo Artist"],
    ["Reference views", "Front, Side — illustrative"],
    ["Private media access", "No customer media exposed by this console"],
  ],
  Payments: [
    ["Stripe Checkout", "Disabled"],
    ["Purchase / refund history", "No live financial data"],
    ["Refund actions", "Disabled"],
  ],
  Credits: [
    [
      "Ledger design",
      "Purchase, reservation, capture, restoration, adjustment, reversal",
    ],
    ["Admin adjustment", "Disabled; reason and audit required"],
    ["Subscriptions", "Future optional feature"],
  ],
  Pricing: [
    ["Configuration", "Server-side customer pricing engine"],
    ["Price changes", "Disabled in this console"],
    [
      "VAT & billing minimums",
      "Require production review and provider verification",
    ],
  ],
  "Provider usage & costs": [
    ["BytePlus OmniHuman 2.0", "Disabled — contract unverified"],
    [
      "Observed model cost",
      "USD 0.07/second before tax; not the customer price",
    ],
    ["fal.ai fallback", "Disabled; never automatic"],
  ],
  "System health": [
    ["Web application", "Demonstration view, not live telemetry"],
    ["Worker", "Inspect worker heartbeat and logs locally"],
    ["Live integration readiness", "Not ready"],
  ],
  Settings: [
    ["New generation switch", "GENERATIONS_ENABLED environment setting"],
    ["Per-job demo spending cap", "MAX_JOB_PRICE_CENTS environment setting"],
    ["Live spending limits", "Must be enforced transactionally before launch"],
  ],
  "Audit log": [
    ["Example event", "Demo admin login"],
    ["Privileged changes", "Disabled"],
    [
      "Production audit records",
      "Server-written, append-only; no client mutation",
    ],
  ],
};
export function Admin({ authorized }: { authorized: boolean }) {
  const [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [section, setSection] = useState("Overview");
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await ensureSession();
      await api("admin/login", {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!authorized)
    return (
      <>
        <h1>Private demo console</h1>
        <p>
          A configured local administrator key is required. This console cannot
          be enabled in production.
        </p>
        <form onSubmit={login} className="content-card settings-form">
          <label>
            Local admin access key
            <input
              type="password"
              autoComplete="current-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <button className="button primary">Unlock local demonstration</button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </>
    );
  return (
    <>
      <div className="page-heading" style={{ marginTop: 35 }}>
        <div>
          <span className="eyebrow">PRIVATE ADMINISTRATION</span>
          <h1>Behind the scenes.</h1>
          <p>
            Demonstration data only. Customer and financial actions are
            disabled.
          </p>
        </div>
        <span className="demo-badge">Authorized local demo</span>
      </div>
      <nav className="admin-menu" aria-label="Administration sections">
        {sections.map((s) => (
          <button
            key={s}
            className={s === section ? "active" : ""}
            onClick={() => setSection(s)}
          >
            {s}
          </button>
        ))}
      </nav>
      <section className="content-card">
        <h2>{section}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Setting / metric</th>
              <th>Demonstration value or readiness</th>
            </tr>
          </thead>
          <tbody>
            {data[section].map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="button outline" disabled>
          Live actions disabled
        </button>
      </section>
      <p className="quiet">
        Before production: verified Supabase identity, server-owned roles, MFA
        (aal2), tested RLS, immutable audit events, and controlled support
        access. No arbitrary database editor or direct customer media links are
        available.
      </p>
    </>
  );
}
