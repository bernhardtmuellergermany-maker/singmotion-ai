"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { offerStudioBudget } from "@/lib/live/studio-budget-review";
type Offer = Awaited<ReturnType<typeof offerStudioBudget>>;
export function StudioBudgetReview({
  budget,
  onSaved,
}: {
  budget: Offer["budget"] | null;
  onSaved: () => Promise<void>;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function review() {
    setBusy(true);
    setError("");
    setMessage("");
    setAccepted(false);
    setOffer(null);
    try {
      setOffer(
        await api<Offer>("studio-live", {
          method: "POST",
          body: JSON.stringify({ action: "budget-review" }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!offer || !accepted) return;
    setBusy(true);
    setError("");
    try {
      await api("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "budget-authorize",
          offerId: offer.id,
          acknowledgment: "AUTHORIZE_EUR50_STUDIO_PLANNING_NOT_A_FEE_GUARANTEE",
        }),
      });
      setOffer(null);
      setAccepted(false);
      setMessage(
        "Budget authorization saved. No generation started. Other readiness requirements still apply.",
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div aria-label="Private Studio budget authorization">
      <h4>EUR 50 total testing budget</h4>
      {budget && (
        <p>
          All reserved: USD {(budget.reservedMicroUsd / 1e6).toFixed(2)}.
          Remaining application allowance: EUR{" "}
          {(budget.remainingMicroEur / 1e6).toFixed(2)} / USD{" "}
          {(budget.remainingMicroUsd / 1e6).toFixed(2)} under {budget.basis}{" "}
          terms. Not a settled balance or invoice guarantee.
        </p>
      )}
      <button
        type="button"
        className="button outline"
        disabled={busy}
        onClick={() => void review()}
      >
        {busy ? "Working…" : "Review / renew EUR 50 budget"}
      </button>
      {offer && (
        <>
          <p>
            ECB reference dated {offer.reference.asOf}: EUR 1 = USD{" "}
            {offer.reference.usdPerEur}.{" "}
            <a
              href={offer.reference.source}
              target="_blank"
              rel="noopener noreferrer"
            >
              Reference source
            </a>
            .
          </p>
          <p>
            Planning conversion: EUR{" "}
            {(offer.review.eurPerUsdUpperPpm / 1e6).toFixed(6)} per USD (twice
            the rounded-up ECB reciprocal), plus EUR 10 reserved for
            conversion/payment fees. These are assumptions, not verified bank
            charges or tax rates.
          </p>
          <p>
            All historical reservations remain: USD{" "}
            {(offer.budget.reservedMicroUsd / 1e6).toFixed(2)}. Remaining
            allowance: EUR {(offer.budget.remainingMicroEur / 1e6).toFixed(2)} /
            USD {(offer.budget.remainingMicroUsd / 1e6).toFixed(2)}. Existing
            server USD and per-job caps still apply. Valid until{" "}
            {offer.review.validUntil}.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              checked={accepted}
              disabled={busy}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I authorize the existing EUR 50 TOTAL budget using these planning
            assumptions. Actual taxes, conversion/payment fees and unresolved
            task charges remain unknown. Failed tasks are not assumed free. This
            does not guarantee the final invoice, reset reservations, resolve
            tasks or approve a generation.
          </label>
          <button
            type="button"
            className="button outline"
            disabled={busy || !accepted}
            onClick={() => void save()}
          >
            Save budget authorization — no generation
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
