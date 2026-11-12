"use client";

import { useId, useState } from "react";
import {
  MAX_CREDIT_TOPUP, MIN_CREDIT_TOPUP, parseCreditTopup, proposedTopupCents
} from "@/lib/commerce/credit-topup-quote";
import "./credit-amount-picker.css";

const PRESETS = [2000, 4000, 10000] as const;
const integer = (value: number) => new Intl.NumberFormat("en-US").format(value);
const euros = (cents: number) => new Intl.NumberFormat("de-DE", {
  style: "currency", currency: "EUR"
}).format(cents / 100);

/** A selectable, custom credit quote. Never calls Stripe until the wallet launch gate exists. */
export function CreditAmountPicker() {
  const [raw, setRaw] = useState("2000");
  const inputId = useId();
  const credits = parseCreditTopup(raw);
  const cents = credits === null ? null : proposedTopupCents(credits);

  return <section className="sm-credit-amount-picker" aria-label="Choose credit amount">
    <div className="sm-credit-amount-heading">
      <div><h2>Choose your credits</h2><p>Pick a popular amount or enter exactly how many credits you want.</p></div>
      <span className="sm-credit-amount-tag">Preview only</span>
    </div>
    <div className="sm-credit-presets" aria-label="Credit amounts">
      {PRESETS.map(amount => <button type="button" key={amount}
        aria-pressed={raw === String(amount)} className={raw === String(amount) ? "sm-credit-preset selected" : "sm-credit-preset"}
        onClick={() => setRaw(String(amount))}>
        <strong>{integer(amount)}</strong><span>Credits</span><small>{euros(amount)}</small>
      </button>)}
    </div>
    <div className="sm-credit-amount-field">
      <label htmlFor={inputId}>Or enter your own credit amount</label>
      <div className="sm-credit-amount-control">
        <input id={inputId} type="number" min={MIN_CREDIT_TOPUP} max={MAX_CREDIT_TOPUP} step="1"
          inputMode="numeric" value={raw} onChange={e=>setRaw(e.target.value)}
          aria-invalid={credits===null} aria-describedby={inputId+"-hint"} />
        <span>Credits</span>
      </div>
      <p id={inputId+"-hint"} className={credits===null?"sm-credit-amount-error":"sm-credit-amount-helper"}>
        {credits===null
          ? "Enter a whole number from 500 to 100,000 credits."
          : "Custom amounts are calculated directly from the entered credit count."}
      </p>
    </div>
    <div className="sm-credit-amount-total" aria-live="polite">
      <div><span>Selected amount</span><strong>{credits===null?"—":integer(credits)+" Credits"}</strong></div>
      <div><span>Proposed total · incl. VAT</span><strong>{cents===null?"—":euros(cents)}</strong></div>
    </div>
    <div className="sm-credit-amount-disabled" aria-disabled="true">Credit checkout coming soon</div>
    <p className="sm-credit-amount-footer">No money is collected and no credits are added by this preview. Minimum 500 credits (5 €), maximum 100,000 credits (1,000 €). Final limits and terms require approval.</p>
  </section>;
}
