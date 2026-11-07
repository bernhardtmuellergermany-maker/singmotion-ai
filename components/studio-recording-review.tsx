"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
export function StudioRecordingReview({
  selection,
  consent,
  termsVersion,
  onSaved,
}: {
  selection: StudioDraftExport;
  consent: boolean;
  termsVersion?: string;
  onSaved: (message: string) => void;
}) {
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message: string }>("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "tempo-recording-review",
          selection,
          consent,
          termsVersion,
          evidence,
          confirmation: confirmed
            ? "INDEPENDENT_NEW_RECORDING_NOT_A_REJECTION_RETRY"
            : "",
        }),
      });
      onSaved(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div aria-label="Independent recording evidence review">
      <h4>Super Admin: independent new recording review</h4>
      <p>
        Legacy recording identity is unknown, not a confirmed match. Upload a
        demonstrably independent recording, then review its source evidence. Do
        not use a renamed, re-encoded, trimmed or tempo-modified version of
        rejected material. This review cannot override a known match or
        establish missing historical provenance.
      </p>
      <label>
        Independent recording evidence reference
        <textarea
          value={evidence}
          maxLength={2000}
          onChange={(e) => {
            setEvidence(e.target.value);
            setConfirmed(false);
          }}
          placeholder="Reference the original recording/session or master, its creation date, and the verifiable basis that it is independent of rejected material. Do not paste credentials or private signed URLs."
        />
      </label>
      <label className="consent">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I reviewed the referenced source evidence. This newly uploaded recording
        is independently sourced, not derived from rejected material. A
        different file hash or upload date alone is insufficient. This is my
        evidence assessment, not new BytePlus permission or reconstructed legacy
        identity.
      </label>
      <button
        className="button outline"
        type="button"
        disabled={busy || !confirmed || !consent || evidence.trim().length < 40}
        onClick={() => void save()}
      >
        Save independent-recording assessment — no generation
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
