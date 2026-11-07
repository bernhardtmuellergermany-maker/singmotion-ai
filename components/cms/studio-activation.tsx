"use client";
import { StudioDurationEditor } from "./studio-duration-editor";
import { useState } from "react";
interface Status {
  staffId: string;
  allowlisted: boolean;
  recoveryEnabled: boolean;
  health: { healthy: boolean; status: string };
  blocker: string | null;
  evidence: {
    reservedMicroUsd: number;
    digest: string;
    hostname: string;
    inputSeconds: number;
    outputSeconds: number;
    sha256: string;
    output: {
      width: number;
      height: number;
      fps: number;
      videoCodec: string;
      audioCodec: string;
    };
  } | null;
}
export function StudioActivation() {
  const [status, setStatus] = useState<Status | null>(null),
    [ceiling, setCeiling] = useState(""),
    [basis, setBasis] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function request(save = false) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        "/api/admin/studio-activation",
        save
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                digest: status?.evidence?.digest,
                ceilingMicroUsd: /^\d+(\.\d{1,6})?$/.test(ceiling)
                  ? Math.round(Number(ceiling) * 1000000)
                  : null,
                evidence: basis,
                confirmation: confirmed
                  ? "APPROVE_SHORT_STUDIO_POLICY_WITH_PROVISIONAL_UPLIFT"
                  : "",
              }),
            }
          : undefined,
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Preparation blocked.");
      if (save)
        setMessage(
          `Private studio-live-policy.json saved. Expires ${data.expiresAt}. No generation was started.`,
        );
      else setStatus(data);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Studio pilot activation — offline only</summary>
      <button disabled={busy} onClick={() => void request()}>
        Inspect successful task / my staff ID / recovery health
      </button>
      {message && <p role="status">{message}</p>}
      {status && (
        <>
          <p>
            Payload staff ID: <code>{status.staffId}</code>. Allowlisted:{" "}
            {String(status.allowlisted)}. Recovery enabled:{" "}
            {String(status.recoveryEnabled)}; healthy:{" "}
            {String(status.health.healthy)} ({status.health.status}).
          </p>
          {status.blocker && <p role="alert">{status.blocker}</p>}
          {status.evidence && (
            <>
              <p>
                Task 2062100414: measured MP3 {status.evidence.inputSeconds}s;
                MP4 {status.evidence.outputSeconds}s;{" "}
                {status.evidence.output.width}×{status.evidence.output.height},{" "}
                {status.evidence.output.fps} FPS,{" "}
                {status.evidence.output.videoCodec}/
                {status.evidence.output.audioCodec}; approved host{" "}
                {status.evidence.hostname}.
              </p>
              <p>MP4 SHA-256: {status.evidence.sha256}</p>
              <p>
                All outstanding ledger reservations: USD{" "}
                {(status.evidence.reservedMicroUsd / 1000000).toFixed(6)}. The
                cumulative server cap must cover this full amount plus the new
                reviewed ceiling; prior tasks are not assumed free.
              </p>
              <p>
                Proposed acceptance limits: 4–5s encoded input, at most 2s
                duration deviation, maximum 6s output. USD 0.07/generated
                second: USD 0.42 base bound for the stated six-second case.
                Provisional 19% planning uplift: USD 0.4998. This is NOT
                verified BytePlus tax, an inclusive invoice guarantee, or proof
                of a duration guarantee for other clips.
              </p>
              <label>
                Separate reviewed inclusive ceiling (USD)
                <input
                  value={ceiling}
                  onChange={(e) => {
                    setCeiling(e.target.value);
                    setConfirmed(false);
                  }}
                  inputMode="decimal"
                />
              </label>
              <label>
                Basis for the inclusive ceiling and short-clip acceptance range;
                do not invent tax/fee evidence
                <textarea
                  value={basis}
                  onChange={(e) => {
                    setBasis(e.target.value);
                    setConfirmed(false);
                  }}
                  maxLength={4000}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I approve this measured host/media policy, the stated acceptance
                limits and the separately reviewed ceiling. The 19% is a
                planning assumption, not verified tax.
              </label>
              <button
                disabled={
                  busy || !confirmed || !ceiling || basis.trim().length < 20
                }
                onClick={() => void request(true)}
              >
                Save private Studio policy — no paid request
              </button>
            </>
          )}
        </>
      )}
      <StudioDurationEditor />
    </details>
  );
}
