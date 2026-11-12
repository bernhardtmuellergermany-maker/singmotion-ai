"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { creditTone } from "@/lib/commerce/credit-display";
import { CreditAmountPicker } from "@/components/credit-amount-picker";

type Entry = { id: string; credits: number; type: "video" | "returned" | "adjustment"; created: number };
type Balance = { availableCredits: number; reservedCredits: number; totalCredits: number; purchaseEnabled: false; entries: Entry[] };
type View = "loading" | "signed-out" | "unavailable" | "ready" | "admin-preview";
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);

export function CreditsDashboard({ mode }: { mode: "buy" | "usage" }) {
  const [view, setView] = useState<View>("loading");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [testCredits, setTestCredits] = useState(1500);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetch("/api/credit-balance", { cache: "no-store", credentials: "same-origin" })
        .then(async (response) => {
          if (response.status === 401) { if (active) setView("signed-out"); return; }
          if (!response.ok) throw new Error("Balance unavailable");
          const result = await response.json() as Balance & { staffPreview?: boolean };
          if (result.staffPreview === true) {
            if (active) { setBalance(null); setView("admin-preview"); }
            return;
          }
          if (!Number.isSafeInteger(result.availableCredits) || result.availableCredits < 0 ||
              !Number.isSafeInteger(result.reservedCredits) || result.reservedCredits < 0 ||
              !Array.isArray(result.entries)) throw new Error("Invalid balance");
          if (active) { setBalance(result); setView("ready"); }
        })
        .catch(() => { if (active) setView("unavailable"); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("credits-changed", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); window.removeEventListener("credits-changed", refresh); };
  }, []);

  const tone = creditTone(view === "ready" ? balance?.availableCredits ?? null : null);
  return <div className="sm-credits-layout">
    {view === "loading" && <p role="status" className="sm-credits-message">Checking your credit balance…</p>}
    {view === "signed-out" && <section className="sm-credits-notice">
      <h2>Sign in to continue</h2>
      <p>Credits belong to your personal account. Guests cannot purchase credits or generate paid videos.</p>
      <Link href="/login" className="sm-plan-action sm-plan-action-outline">Sign in or create an account</Link>
    </section>}
    {view === "unavailable" && <section className="sm-credits-notice" role="status">
      <h2>Balance currently unavailable</h2>
      <p>We cannot confirm your credit balance right now. No credits have been purchased or charged by this page.</p>
      <Link href="/account/settings">Account settings</Link>
    </section>}
    {view === "admin-preview" && <section className="sm-credits-summary sm-credits-admin-preview" aria-label="Super Admin credit preview">
      <div className="sm-credits-admin-body">
        <span className="sm-credits-eyebrow">Super Admin · Testansicht</span>
        <strong className={`sm-credits-balance sm-credits-${creditTone(testCredits)}`}>{number(testCredits)} <span className="sm-credits-preview-unit">Test-Credits</span></strong>
        <p className="sm-credits-muted">Nur eine visuelle Vorschau. Kein Kundenkonto, keine echten Credits, keine Zahlung und keine Buchung.</p>
        <div className="sm-credits-admin-controls" role="group" aria-label="Test credit balance and warning colors">
          {[0, 500, 1500].map(amount => <button key={amount} type="button"
            aria-pressed={testCredits===amount} onClick={()=>setTestCredits(amount)}>
            {number(amount)} Credits
          </button>)}
        </div>
        {mode==="usage" && <div className="sm-credits-admin-usage">
          <h2>Usage preview</h2><p className="sm-credits-muted">Nach Aufladung +2.000, Videogenerierung −250, bestätigter Providerfehler: 250 Credits entsperrt. Beispieldaten, keine echten Transaktionen.</p>
        </div>}
      </div>
      <div className="sm-credits-summary-links"><Link href="/credits">Credit options</Link><Link href="/usage">Usage preview</Link></div>
    </section>}
    {view === "ready" && balance && <>
      <section className="sm-credits-summary" aria-label="Credit overview">
        <div><span className="sm-credits-eyebrow">Available credits</span>
          <strong className={`sm-credits-balance sm-credits-${tone}`} aria-live="polite">{number(balance.availableCredits)}</strong>
          <span className="sm-credits-reserved">{number(balance.reservedCredits)} credits currently reserved</span>
        </div>
        <div className="sm-credits-summary-links">
          <Link href="/credits">Credit options</Link>
          <Link href="/usage">Usage history</Link>
        </div>
      </section>
      {mode === "usage" && <section className="sm-credits-history">
        <h2>Credit history</h2>
        <p className="sm-credits-muted">This overview shows recorded account credit entries. Reserved credits are shown separately from available credits and are not charged a second time.</p>
        {balance.entries.length === 0 ? <p className="sm-credits-empty">No credit transactions recorded yet.</p> :
         <ul>{balance.entries.map((entry) => <li key={entry.id}>
          <span><strong>{entry.type === "video" ? "Video generation" : entry.type === "returned" ? "Credits returned" : "Account credit adjustment"}</strong>
            <small>{new Date(entry.created).toLocaleDateString("en-GB", {day:"numeric",month:"short",year:"numeric"})}</small></span>
          <strong className={entry.credits > 0 ? "sm-credits-positive" : ""}>{entry.credits > 0 ? "+" : ""}{number(entry.credits)} credits</strong>
         </li>)}</ul>}
      </section>}
    </>}
    {mode === "buy" && <CreditAmountPicker/>}
  </div>;
}
