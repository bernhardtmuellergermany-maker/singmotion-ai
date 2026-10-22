"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ensureSession, resetSession } from "@/lib/client";
import { money, type Job } from "@/lib/domain";
export function Billing({ referencePrice }: { referencePrice: number }) {
  const [credits, setCredits] = useState<number | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    ensureSession()
      .then(() =>
        Promise.all([api<{ balance: number }>("session"), api<Job[]>("jobs")]),
      )
      .then(([s, j]) => {
        setCredits(s.balance);
        setJobs(j);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div id="content" className="narrow">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP CREATING</span>
          <h1>Credits & billing</h1>
          <p>A clear price for every performance. No subscription required.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="content-card">
        <span className="demo-badge">
          Simulated balance · no monetary value
        </span>
        <div className="balance-number">
          {credits === null ? "—" : money(credits)}
        </div>
        <p>
          Demo credits let you explore the complete workflow. No payments or
          paid AI requests are enabled.
        </p>
        <button disabled className="button primary">
          Buy credits — coming later
        </button>
      </div>
      <div className="content-card">
        <h2>Simple, duration-based pricing</h2>
        <p>
          Our illustrative customer reference is {money(referencePrice)} for 10
          seconds, including German VAT when applicable. Your exact total
          appears before generation. Custom performance prompts carry no
          additional fee.
        </p>
        <p style={{ marginTop: 12 }}>
          Live provider minimums are not yet verified. Prepaid bundles and
          optional subscriptions are planned; checkout, refunds, and
          subscriptions remain disabled.
        </p>
      </div>
      <div className="content-card">
        <h2>Demo activity</h2>
        {jobs.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Demo credits</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.artistName}</td>
                  <td>{j.status}</td>
                  <td>
                    {money(j.price)}{" "}
                    {["failed", "cancelled"].includes(j.status)
                      ? "restored"
                      : j.status === "completed"
                        ? "used"
                        : "reserved"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>
            Your simulated activity will appear here. No purchases have been
            made.
          </p>
        )}
      </div>
    </div>
  );
}
export function Settings() {
  const router = useRouter();
  const [name, setName] = useState(""),
    [tips, setTips] = useState("show"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const p = JSON.parse(
          localStorage.getItem("singmotion-preferences") || "{}",
        );
        setName(p.name || "");
        setTips(p.tips || "show");
      } catch {}
    });
  }, []);
  async function remove() {
    if (
      !confirm(
        "Permanently delete all files, artists, and projects in this demo session?",
      )
    )
      return;
    setBusy(true);
    try {
      await api("account", { method: "DELETE" });
      resetSession();
      localStorage.removeItem("singmotion-studio");
      localStorage.removeItem("singmotion-preferences");
      router.push("/");
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="narrow" id="content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h1>Your settings</h1>
          <p>Preferences for this browser’s private demonstration workspace.</p>
        </div>
      </div>
      <form
        className="content-card settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          localStorage.setItem(
            "singmotion-preferences",
            JSON.stringify({ name, tips }),
          );
          setMessage("Preferences saved in this browser.");
        }}
      >
        <label>
          Display name
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </label>
        <label>
          Preferred guidance level (saved for future personalization)
          <select value={tips} onChange={(e) => setTips(e.target.value)}>
            <option value="show">Show helpful guidance</option>
            <option value="compact">Keep it compact</option>
          </select>
        </label>
        <button type="submit" className="button primary">
          Save preferences
        </button>
      </form>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="content-card">
        <h2>Your demo account</h2>
        <p>
          This version uses an anonymous, private session cookie valid for 30
          days. It is not a production account. Supabase email sign-in, account
          recovery, and account management require secure backend activation.
          Keep this browser session to revisit your projects.
        </p>
      </div>
      <div className="content-card">
        <h2>Delete your demo data</h2>
        <p>
          Remove your uploaded music, reference images, artist profiles,
          generated sample copies, and projects. Active jobs must finish first.
          This cannot be undone.
        </p>
        <button
          disabled={busy}
          className="button outline danger"
          onClick={() => void remove()}
        >
          {busy ? "Deleting…" : "Delete all my demo data"}
        </button>
      </div>
    </div>
  );
}
