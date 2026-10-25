"use client";
import { useState } from "react";
import type { DurationBandReview } from "@/lib/live/studio-duration-admin";
const numeric = {
  minInputSeconds: "Minimum encoded input (seconds)",
  maxInputSeconds: "Maximum encoded input (seconds)",
  maxGeneratedSeconds: "Reviewed maximum generated video (seconds)",
  ceilingUsd: "Separate inclusive spending ceiling (USD)",
  maxBytes: "Maximum output file size (bytes, up to 268435456)",
  timeoutSeconds: "Download timeout (seconds, 1–180)",
  width: "Validated video width",
  height: "Validated video height",
  fps: "Validated FPS",
  toleranceSeconds: "Allowed input/output duration deviation (seconds)",
};
const textFields = {
  billingEvidence:
    "Reviewed inclusive billing evidence (taxes/fees and ceiling basis)",
  durationEvidence: "Reviewed duration evidence covering the entire band",
  outputEvidence: "Reviewed exact hostname and media validation evidence",
  transferEvidence: "Reviewed file-size and download-limit evidence",
  hosts: "Approved exact output hostnames (one per line; no wildcards)",
};
type Fields = Record<keyof DurationBandReview, string>;
const blank = (): Fields => ({
  minInputSeconds: "5",
  maxInputSeconds: "15",
  maxGeneratedSeconds: "",
  ceilingUsd: "",
  billingEvidence: "",
  durationEvidence: "",
  outputEvidence: "",
  transferEvidence: "",
  maxBytes: "",
  timeoutSeconds: "",
  hosts: "",
  width: "",
  height: "",
  fps: "",
  videoCodec: "",
  audioCodec: "",
  toleranceSeconds: "",
  expiresAt: "",
});
interface Loaded {
  digest: string;
  bands: DurationBandReview[];
  shortRange: { minInputSeconds: number; maxInputSeconds: number };
  shortExpiresAt: string;
  limits: {
    enabled: boolean;
    maxDurationSeconds: number;
    maxJobMicroUsd: number;
    maxTotalMicroUsd: number;
  };
}
export function StudioDurationEditor() {
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [fields, setFields] = useState(blank),
    [index, setIndex] = useState(0),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const change = (key: keyof Fields, value: string) => {
    setFields((old) => ({ ...old, [key]: value }));
    setConfirmed(false);
  };
  async function load() {
    const response = await fetch("/api/admin/studio-activation?duration=1");
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Duration policy unavailable.");
    setLoaded(data);
    setIndex(data.bands.length);
    setFields(blank());
    setConfirmed(false);
  }
  async function run(save: boolean) {
    setBusy(true);
    setMessage("");
    try {
      if (!save) await load();
      else {
        const review: Record<string, unknown> = { ...fields };
        for (const key of Object.keys(numeric))
          review[key] = fields[key as keyof Fields].trim()
            ? Number(fields[key as keyof Fields])
            : null;
        const response = await fetch("/api/admin/studio-activation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save-duration-band",
            digest: loaded?.digest,
            index,
            review,
            confirmation: confirmed ? "APPROVE_REVIEWED_DURATION_BAND" : "",
          }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Duration policy save blocked.");
        await load();
        setMessage(
          "Reviewed duration band saved. Original short policy and budget settings preserved. No paid request or server-gate change.",
        );
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const generated = Number(fields.maxGeneratedSeconds);
  return (
    <section aria-label="Video duration & budget">
      <h3>Video duration &amp; budget</h3>
      <p>
        Add or edit separately reviewed duration bands. The existing 4–5-second
        policy stays unchanged. A five-second success does not prove
        fifteen-second output bounds.
      </p>
      <button disabled={busy} onClick={() => void run(false)}>
        Load duration bands
      </button>
      {message && <p role="status">{message}</p>}
      {loaded && (
        <>
          <p>
            Preserved short range: {loaded.shortRange.minInputSeconds}–
            {loaded.shortRange.maxInputSeconds}s; expiry {loaded.shortExpiresAt}
            .
          </p>
          <p>
            Server gates (read-only): pilot{" "}
            {loaded.limits.enabled ? "enabled" : "disabled"}; maximum input{" "}
            {loaded.limits.maxDurationSeconds}s; per-job cap USD{" "}
            {(loaded.limits.maxJobMicroUsd / 1e6).toFixed(6)}; cumulative USD
            cap {(loaded.limits.maxTotalMicroUsd / 1e6).toFixed(6)}. EUR 50
            authorization and all historical reservations still apply.
          </p>
          {Number(fields.maxInputSeconds) >
            loaded.limits.maxDurationSeconds && (
            <p role="alert">
              Server duration cap is below this band. Saving a review does not
              raise that cap.
            </p>
          )}
          {Number(fields.ceilingUsd) * 1e6 > loaded.limits.maxJobMicroUsd && (
            <p role="alert">
              Reviewed ceiling exceeds the server per-video cap. Submission
              remains blocked.
            </p>
          )}
          <label>
            Duration band
            <select
              value={index}
              onChange={(e) => {
                const next = Number(e.target.value);
                setIndex(next);
                setConfirmed(false);
                setFields(
                  loaded.bands[next]
                    ? (Object.fromEntries(
                        Object.entries(loaded.bands[next]).map(([k, v]) => [
                          k,
                          String(v),
                        ]),
                      ) as Fields)
                    : blank(),
                );
              }}
            >
              {loaded.bands.map((b, i) => (
                <option key={i} value={i}>
                  {b.minInputSeconds}–{b.maxInputSeconds} seconds
                </option>
              ))}
              <option value={loaded.bands.length}>
                Add new band (5–15 seconds)
              </option>
            </select>
          </label>
          {Object.entries(numeric).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                step="any"
                value={fields[key as keyof Fields]}
                onChange={(e) => change(key as keyof Fields, e.target.value)}
              />
            </label>
          ))}
          {Object.entries(textFields).map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                maxLength={4000}
                value={fields[key as keyof Fields]}
                onChange={(e) => change(key as keyof Fields, e.target.value)}
              />
            </label>
          ))}
          <label>
            Video codec
            <select
              value={fields.videoCodec}
              onChange={(e) => change("videoCodec", e.target.value)}
            >
              <option value="">Choose reviewed codec</option>
              <option>h264</option>
              <option>hevc</option>
            </select>
          </label>
          <label>
            Audio codec
            <select
              value={fields.audioCodec}
              onChange={(e) => change("audioCodec", e.target.value)}
            >
              <option value="">Choose reviewed codec</option>
              <option>aac</option>
            </select>
          </label>
          <label>
            Review expiry (ISO UTC, within seven days)
            <input
              value={fields.expiresAt}
              placeholder="YYYY-MM-DDTHH:mm:ssZ"
              onChange={(e) => change("expiresAt", e.target.value)}
            />
          </label>
          <p>
            Base estimate: USD 0.07 per generated second
            {generated > 0 && Number.isFinite(generated)
              ? ` → USD ${(generated * 0.07).toFixed(4)} for the entered maximum; provisional 19% planning amount USD ${(generated * 0.07 * 1.19).toFixed(4)}`
              : ""}
            . Neither this estimate nor the provisional uplift is verified
            BytePlus tax or a guaranteed inclusive charge.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the evidence for this entire duration range, inclusive
            spending ceiling and exact output policy. I am not extrapolating the
            five-second example or treating 19% as verified tax.
          </label>
          <button disabled={busy || !confirmed} onClick={() => void run(true)}>
            Save reviewed duration band — no paid request
          </button>
        </>
      )}
    </section>
  );
}
