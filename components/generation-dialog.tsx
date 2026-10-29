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
  projectName,
  requestKey,
  onClose,
}: {
  selection: StudioDraftExport;
  artistName: string;
  projectName: string;
  requestKey: string;
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
  // Prepare and price server-side inside the same dialog once the operator
  // accepts the media rights. This is NOT a paid provider submission.
  useEffect(() => {
    if (
      !rights ||
      !terms ||
      pilot !== true ||
      blockers.length ||
      plan ||
      busy ||
      error ||
      lock.current
    )
      return;
    lock.current = true;
    setBusy(true);
    void api<StudioProject>("studio-live", {
      method: "POST",
      body: JSON.stringify({
        action: "prepare",
        requestKey,
        selection,
        artistName,
        projectName,
        consent: true,
        termsVersion: terms,
        english: true,
      }),
    })
      .then((prepared) => {
        setPlan(prepared);
      })
      .catch((cause) => {
        setError((cause as Error).message);
      })
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }, [
    rights,
    terms,
    pilot,
    blockers.length,
    plan,
    busy,
    error,
    selection,
    artistName,
    projectName,
    requestKey,
  ]);
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
              requestKey,
              selection,
              artistName,
              projectName,
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
      // Retain the exact saved plan on an uncertain HTTP result. Retrying this
      // id is idempotent; never prepare a replacement automatically.
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
    !plan ||
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
        BytePlus base rate: USD 0.07 per billable generated second. The server
        calculates the estimate after preparing your audio. Actual generated
        duration, fees and taxes may differ.
      </p>
      <p>
        {selection.start.toFixed(2)}–{selection.end.toFixed(2)} seconds ·{" "}
        {plan?.prompt ||
          selection.customPrompt ||
          `${selection.performance} · ${selection.camera}`}
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
          <Link href="/operator-signin">Private operator sign in</Link> ·{" "}
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
                BytePlus base estimate: {usd(plan.estimatedBaseMicroUsd)}. Based
                on the reviewed generated-duration bound
                {plan.estimatedGeneratedSeconds
                  ? ` of ${plan.estimatedGeneratedSeconds.toFixed(3)}s`
                  : ""}
                , including the prepared audio duration. Support-reported
                billing rounds generated seconds down, with a one-second
                minimum. Actual billed duration, taxes and fees remain subject
                to the provider invoice.
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
          I confirm that I own or have obtained all necessary rights and
          permissions for the uploaded music, audio, image and depicted
          person(s), and authorize their processing for this video. I accept the{" "}
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
                  : "Resolve the displayed operator authorization or provider policy requirements before generating."}
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
                : "Preparing cost estimate…"}
          </button>
        )}
      </div>
    </dialog>
  );
}
