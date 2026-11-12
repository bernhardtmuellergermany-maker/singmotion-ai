"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { creditTone } from "@/lib/commerce/credit-display";

type Entry = { id: string; credits: number; type: "video" | "returned" | "adjustment"; created: number };
type Balance = { availableCredits: number; reservedCredits: number; totalCredits: number; purchaseEnabled: false; entries: Entry[] };
type View = "loading" | "signed-out" | "unavailable" | "ready";
const packs = [
  { euro: 20, credits: 2000 },
  { euro: 40, credits: 4000 },
  { euro: 100, credits: 10000 },
] as const;
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);

export function CreditsDashboard({ mode }: { mode: "buy" | "usage" }) {
  const [view, setView] = useState<View>("loading");
  const [balance, setBalance] = useState<Balance | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetch("/api/credit-balance", { cache: "no-store", credentials: "same-origin" })
        .then(async (response) => {
          if (response.status === 401) { if (active) setView("signed-out"); return; }
          if (!response.ok) throw new Error("Balance unavailable");
          const result = await response.json() as Balance;
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
    {mode === "buy" && <section className="sm-credits-packs" aria-label="Proposed top-up packages">
      <div className="sm-credits-section-head"><h2>Choose a credit package</h2><span className="sm-credits-coming">Coming soon</span></div>
      <p className="sm-credits-muted">Proposed prepaid packages. Purchases are not enabled yet, and these packages cannot be ordered on this page.</p>
      <div className="sm-credits-pack-grid">{packs.map((pack) => <article key={pack.euro} className="sm-credits-pack">
        <strong>€{pack.euro}</strong><span>{number(pack.credits)} Credits</span>
        <small>Including VAT · proposed</small>
      </article>)}</div>
      <p className="sm-credits-muted">1 credit equals €0.01 of internal video credit. A custom amount and optional auto top-up are planned only after payment, refund and spending-limit checks are complete.</p>
      <span className="sm-credits-disabled-purchase" aria-disabled="true">Stripe credit purchases not yet available</span>
      <p className="sm-credits-muted">Credits are not cash and cannot be transferred. Consumer rights and refunds remain governed by applicable law.</p>
    </section>}
  </div>;
}
