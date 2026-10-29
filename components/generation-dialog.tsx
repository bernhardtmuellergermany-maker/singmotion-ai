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
  songName,
  requestKey,
  onClose,
}: {
  selection: StudioDraftExport;
  artistName: string;
  projectName: string;
  songName: string;
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
  const selectedSeconds = Math.max(0, selection.end - selection.start);
  const time = (seconds: number) => {
    const centis = Math.round(Math.max(0, seconds) * 100);
    return String(Math.floor(centis / 6000)).padStart(2, "0") + ":" +
      String(Math.floor((centis % 6000) / 100)).padStart(2, "0") + "." +
      String(centis % 100).padStart(2, "0");
  };
  return (
    <dialog ref={dialog} className="product-dialog product-theme sm-confirm-simple"
      onCancel={onClose} onClose={onClose} aria-labelledby="confirm-generation-title">
      <h2 id="confirm-generation-title">Confirm generation</h2>
      <div className="sm-confirm-summary">
        <div><span>Price</span><strong>{plan ? usd(plan.estimatedBaseMicroUsd) : `$${(selectedSeconds * 0.07).toFixed(2)}`}</strong></div>
        <div><span>Duration</span><strong>{time(selectedSeconds)}</strong></div>
        <div><span>Song</span><strong className="sm-confirm-song" title={songName}>{songName}</strong></div>
      </div>
      <label className="consent sm-confirm-consent">
        <input type="checkbox" checked={rights} disabled={busy} onChange={e=>setRights(e.target.checked)}/>
        <span>I confirm that I own the rights or have permission to use this audio, image, and any depicted person(s).</span>
      </label>
      <p className="sm-confirm-links">View <Link href="/terms" target="_blank">Terms</Link> &amp; <Link href="/privacy" target="_blank">Privacy Policy</Link></p>
      {pilot === null && <p role="status" className="sm-confirm-notice">Checking availability…</p>}
      {pilot === false && <p role="status" className="sm-confirm-notice">Customer generation is not available yet.</p>}
      {blockers.length > 0 && <p role="alert" className="sm-confirm-notice">{blockers.join(" ")}</p>}
      {plan?.budgetBlocker && <p role="alert" className="sm-confirm-notice">{plan.budgetBlocker}</p>}
      {error && <p role="alert" className="sm-confirm-notice">{error}</p>}
      <div className="product-actions">
        <button type="button" className="product-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="product-primary" disabled={blocked} onClick={()=>void act()}>
          {busy ? "Working…" : "Generate video"}
        </button>
      </div>
    </dialog>
  );
}
