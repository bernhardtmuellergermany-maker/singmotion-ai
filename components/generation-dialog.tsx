"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
import type { StudioProject } from "@/lib/live/studio";
const usd = (n: number) => `USD ${(n / 1000000).toFixed(2)}`;
export function GenerationDialog({
  selection,
  artistName,
  onClose,
}: {
  selection: StudioDraftExport;
  artistName: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false),
    router = useRouter();
  const [rights, setRights] = useState(false),
    [terms, setTerms] = useState(""),
    [plan, setPlan] = useState<StudioProject | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pilot, setPilot] = useState<boolean | null>(null),
    [blockers, setBlockers] = useState<string[]>([]);
  useEffect(() => {
    dialog.current?.showModal();
    let current = true;
    void Promise.all([
      api<{ version: string }>("rights"),
      api<{
        pilot?: boolean;
        available: boolean;
        blockers: string[];
        dailyBudget?: { day: string; reservedMicroEur: number };
      }>("studio-live"),
    ])
      .then(([t, r]) => {
        if (current) {
          setTerms(t.version);
          setPilot(r.pilot === true);
          setBlockers(r.blockers || []);
        }
      })
      .catch(() => {
        if (current)
          setError("Could not load authorization. Please close and try again.");
      });
    return () => {
      current = false;
    };
  }, []);
  async function act(repeatOf?: string) {
    if (lock.current || !rights || !terms || !pilot || blockers.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!plan || repeatOf) {
        setPlan(
          await api<StudioProject>("studio-live", {
            method: "POST",
            body: JSON.stringify({
              action: "prepare",
              selection,
              artistName,
              consent: true,
              termsVersion: terms,
              english: true,
              ...(repeatOf ? { repeatOf } : {}),
            }),
          }),
        );
        return;
      }
      if (
        plan.state !== "prepared" ||
        !plan.digest ||
        !plan.ceilingMicroUsd ||
        plan.budgetBlocker
      )
        throw Error(
          "This project cannot be submitted. Open its saved status or operator review.",
        );
      await api("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          id: plan.id,
          digest: plan.digest,
          ceilingMicroUsd: plan.ceilingMicroUsd,
          consent: true,
          termsVersion: terms,
          confirmation: `CONFIRM PAID STUDIO ${plan.id} ${plan.digest} ${plan.ceilingMicroUsd}${plan.experimental ? " ACCEPT EXPERIMENTAL UNKNOWN DURATION FEES MEDIA" : ""}`,
        }),
      });
      router.push(`/projects/live_${plan.id}`);
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const blocked =
    busy ||
    !rights ||
    !terms ||
    pilot !== true ||
    blockers.length > 0 ||
    !!(
      plan &&
      (plan.state !== "prepared" ||
        !plan.digest ||
        !plan.ceilingMicroUsd ||
        plan.budgetBlocker)
    );
  return (
    <dialog
      ref={dialog}
      className="product-dialog product-theme"
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="confirm-generation-title"
    >
      <h2 id="confirm-generation-title">Your performance</h2>
      <p>
        {(selection.end - selection.start).toFixed(3)}s audio ·{" "}
        {selection.outputFormat || "Reviewed format"} · {artistName}
      </p>
      <p>
        BytePlus base-rate illustration: USD {((selection.end - selection.start) * 0.07).toFixed(2)}
        {" "}at $0.07 per second of selected audio. The provider bills generated
        video seconds, which may differ; taxes and fees are not included.
      </p>
      <p>
        Local fitting may add borders; this is not a promise of native landscape
        generation.
      </p>
      {pilot === null && <p role="status">Checking access and price…</p>}
      {pilot === false && (
        <div>
          <p>
            Customer checkout is not available yet. No payment or generation
            will be started.
          </p>
          <Link href="/signin">Account access</Link> ·{" "}
          <Link href="/checkout">Guest checkout information</Link>
        </div>
      )}
      {pilot && (
        <>
          <p>
            Private operator generation. No customer payment or credit
            deduction.
          </p>
          {plan ? (
            <>
              <p>Measured provider audio: {plan.durationSeconds.toFixed(3)}s</p>
              <p>
                Pre-tax provider estimate: {usd(plan.estimatedBaseMicroUsd)}.
                Not a customer sale price.
              </p>
              <p>
                Reviewed reservation:{" "}
                <strong>
                  {plan.ceilingMicroUsd === null
                    ? "Unavailable"
                    : usd(plan.ceilingMicroUsd)}
                </strong>
                .
              </p>
              {plan.experimental && (
                <p>
                  Experimental: generated duration, fees and media properties
                  remain unknown. This reservation is not a guaranteed invoice
                  amount. Confirming accepts these reviewed risks.
                </p>
              )}
              {plan.budget && (
                <p>
                  Remaining authorized allowance: EUR{" "}
                  {(plan.budget.remainingMicroEur / 1000000).toFixed(2)}.
                  Unresolved reservations remain included.
                </p>
              )}
              {plan.budgetBlocker && <p role="alert">{plan.budgetBlocker}</p>}
              <Link href={`/projects/live_${plan.id}`}>
                Saved project · {plan.state}
              </Link>
            </>
          ) : (
            <p>
              The exact reservation is calculated on the server after media
              preparation. Reviewing it makes no paid request.
            </p>
          )}
        </>
      )}
      <label className="consent">
        <input
          type="checkbox"
          checked={rights}
          disabled={busy}
          onChange={(e) => setRights(e.target.checked)}
        />
        <span>
          I own or have permission for the music, sound recording, image and
          likeness, including this AI processing. I have reviewed the English
          performance prompt and the{" "}
          <Link href="/terms" target="_blank">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank">
            Privacy notice
          </Link>
          .
        </span>
      </label>
      {blockers.length > 0 && (
        <p role="status">
          {blockers.join(" ")}{" "}
          <Link href="/operator">Operator settings and recovery</Link>
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <Link href="/operator">Operator review</Link>
        </p>
      )}
      {blocked && pilot && (
        <p className="field-note">
          {busy
            ? "Processing your request…"
            : !rights
              ? "Confirm your rights before continuing."
              : !terms
                ? "Current Terms are unavailable."
                : plan && plan.state !== "prepared"
                  ? "This project already has a status. Open the saved project; do not submit it again."
                  : "Resolve the displayed authorization or budget requirements before generating."}
        </p>
      )}
      {plan && ["completed", "failed"].includes(plan.state) && (
        <button
          className="product-secondary"
          disabled={busy || !rights || blockers.length > 0}
          onClick={() => void act(plan.id)}
        >
          Review another performance with these inputs
        </button>
      )}
      <div className="product-actions">
        <button className="product-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {pilot && (
          <button
            className="product-primary"
            disabled={blocked}
            onClick={() => void act()}
          >
            {busy
              ? "Working…"
              : plan
                ? "Confirm & generate"
                : "Review generation cost"}
          </button>
        )}
      </div>
    </dialog>
  );
}
