"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
type Review = Record<string, string | number | null>;
type Plan = {
  id: string;
  state: string;
  taskId: string | null;
  failureCode: string | null;
  seconds: number;
  prompt: string;
  costReview: Review;
  costDigest: string | null;
  outputReview: Review | null;
  outputDigest: string | null;
  observedHostname: string | null;
  completed: boolean;
};
type Report = { plan: Plan | null; blocker: string | null };
const endpoint = "/api/admin/first-test";
const bindings = new Set([
  "kind",
  "planId",
  "owner",
  "audioSha256",
  "imageSha256",
  "promptSha256",
  "encodedAudioSeconds",
  "taskId",
  "costReviewDigest",
]);
function ReviewFields({
  value,
  setValue,
}: {
  value: Review;
  setValue: (v: Review) => void;
}) {
  return (
    <>
      {Object.entries(value)
        .filter(([key]) => !bindings.has(key))
        .map(([key, current]) => (
          <label key={key} style={{ display: "block", margin: "12px 0" }}>
            {key}
            {key.endsWith("MicroUsd") ? " (microUSD: 1 USD = 1,000,000)" : ""}
            {key === "evidence" ? (
              <textarea
                aria-label={key}
                rows={3}
                style={{ width: "100%" }}
                value={String(current ?? "")}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            ) : (
              <input
                aria-label={key}
                style={{ display: "block", width: "100%" }}
                type={
                  typeof current === "number" ||
                  key.endsWith("MicroUsd") ||
                  key.endsWith("Seconds") ||
                  ["width", "height", "fps"].includes(key)
                    ? "number"
                    : "text"
                }
                step="any"
                value={current ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    [key]:
                      e.target.type === "number"
                        ? e.target.value === ""
                          ? null
                          : Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}
          </label>
        ))}
    </>
  );
}
export function FirstTestPanel() {
  const [report, setReport] = useState<Report>({ plan: null, blocker: null });
  const [cost, setCost] = useState<Review>({}),
    [output, setOutput] = useState<Review>({});
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [phrase, setPhrase] = useState("");
  const [downloadApproval, setDownloadApproval] = useState(false);
  const [prepared, setPrepared] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error || prepared) {
      feedback.current?.focus();
      feedback.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error, prepared]);
  const plan = report.plan;
  async function request(body?: Record<string, unknown> | FormData) {
    setBusy(true);
    setError("");
    setPrepared("");
    try {
      const response = await fetch(endpoint, {
        method: body ? "POST" : "GET",
        ...(body
          ? {
              body: body instanceof FormData ? body : JSON.stringify(body),
              headers:
                body instanceof FormData
                  ? {}
                  : { "Content-Type": "application/json" },
            }
          : {}),
      });
      const data = await response.json().catch(() => {
        throw new Error(
          `Server returned an unreadable response (HTTP ${response.status}). Refresh saved status before retrying. Your selected files are retained.`,
        );
      });
      if (!response.ok)
        throw new Error(
          [
            data?.error || `Request failed (HTTP ${response.status}).`,
            ...(Array.isArray(data?.issues) ? data.issues : []).map(
              (i: { field: string; message: string }) =>
                `${i.field}: ${i.message}`,
            ),
          ].join("\n"),
        );
      if (
        !data ||
        !Object.hasOwn(data, "plan") ||
        (body && !data.plan) ||
        (data.plan &&
          (typeof data.plan.id !== "string" ||
            typeof data.plan.state !== "string" ||
            !data.plan.costReview))
      )
        throw new Error(
          `Server did not return a saved plan/status (HTTP ${response.status}). Refresh saved status before retrying. Your selected files and previous plan are retained.`,
        );
      setReport(data);
      setCost(data.plan?.costReview || {});
      setOutput(data.plan?.outputReview || {});
      setPhrase("");
      setDownloadApproval(false);
      if (body instanceof FormData)
        setPrepared(
          `Prepared offline. Saved plan ${data.plan.id}. No paid request was made.`,
        );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Request failed. Refresh saved status before any further action.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cannot load private test status.");
        return response.json();
      })
      .then((data) => {
        setReport(data);
        setCost(data.plan?.costReview || {});
        setOutput(data.plan?.outputReview || {});
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Cannot load private test status. Refresh before proceeding.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("rights", form.has("rights") ? "true" : "false");
    form.set("english", form.has("english") ? "true" : "false");
    await request(form);
  }
  const action = (name: string) =>
    request({
      action: name,
      plan: plan!.id,
      confirmation: plan!.costDigest,
      outputConfirmation: plan!.outputDigest,
      phrase,
    });
  const media = (kind: string) =>
    `${endpoint}?plan=${encodeURIComponent(plan!.id)}&media=${kind}`;
  const approval = plan
    ? `AUTHORIZE ONE PAID BYTEPLUS TEST ${plan.id} UP TO ${plan.costReview.inclusiveMaxMicroUsd} MICROUSD`
    : "";
  return (
    <section
      aria-label="OmniHuman first test"
      style={{
        padding: 24,
        border: "1px solid var(--theme-elevation-150)",
        marginBottom: 24,
      }}
    >
      <h2>OmniHuman 2.0 — one controlled test</h2>
      <p>
        Super Admin only. Preparation is offline. Starting one paid task
        requires a reviewed inclusive cost bound and separate server
        authorization. Public generation stays disabled.
      </p>
      {report.blocker && <p role="status">{report.blocker}</p>}
      <button type="button" disabled={busy} onClick={() => request()}>
        Refresh saved status
      </button>
      {(!plan || plan.state === "prepared") && (
        <details open={!plan}>
          <summary>1. Upload private test inputs</summary>
          <form onSubmit={upload}>
            <label>
              Singer image (JPEG/PNG, max 5 MB)
              <input
                required
                name="image"
                type="file"
                accept="image/jpeg,image/png"
              />
            </label>
            <br />
            <label>
              Prepared MP3 (actual encoded duration 4–5 seconds, under 15 MB)
              <input
                required
                name="audio"
                type="file"
                accept="audio/mpeg,.mp3"
              />
            </label>
            <br />
            <label>
              Optional English performance prompt
              <textarea name="prompt" maxLength={1000} />
            </label>
            <br />
            <label>
              <input required name="rights" type="checkbox" /> I have permission
              to use this music and likeness.
            </label>
            <br />
            <label>
              <input required name="english" type="checkbox" /> I confirm the
              performance direction is English.
            </label>
            <br />
            <button disabled={busy}>Prepare offline — no paid request</button>
          </form>
        </details>
      )}
      {(error || prepared) && (
        <p
          ref={feedback}
          tabIndex={-1}
          role={error ? "alert" : "status"}
          style={{ whiteSpace: "pre-wrap" }}
        >
          {error || prepared}
        </p>
      )}
      {plan && (
        <>
          <h3>Plan {plan.id}</h3>
          <p>
            Status: <strong>{plan.state}</strong> · Task:{" "}
            {plan.taskId || "Not submitted"} · Encoded audio: {plan.seconds}{" "}
            seconds
          </p>
          {plan.failureCode && <p>{plan.failureCode} — do not submit again.</p>}
          {/* Only owned, authenticated local endpoints; never provider/R2 bearer URLs. */}
          <img
            src={media("image")}
            alt="Private singer reference for this test"
            style={{ maxWidth: 200, maxHeight: 240 }}
          />
          <audio controls src={media("audio")} />
          <p>Composed prompt: {plan.prompt}</p>
          <details>
            <summary>Immutable content hashes</summary>
            <pre style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(
                Object.fromEntries(
                  Object.entries(plan.costReview).filter(([key]) =>
                    bindings.has(key),
                  ),
                ),
                null,
                2,
              )}
            </pre>
          </details>
          <details open={plan.state === "prepared"}>
            <summary>2. Review inclusive cost</summary>
            <p>
              No amounts or evidence are inferred. Document the exact clip’s
              generated-duration bound, base cost, taxes and fees. reviewedAt
              must be ISO UTC. acknowledgment must be
              INCLUSIVE_BOUND_FOR_EXACT_INPUT.
            </p>
            <fieldset disabled={busy || plan.state !== "prepared"}>
              <ReviewFields value={cost} setValue={setCost} />
              <button
                type="button"
                onClick={() =>
                  request({
                    action: "cost-review",
                    plan: plan.id,
                    review: cost,
                  })
                }
              >
                Validate and save cost review — offline
              </button>
            </fieldset>
          </details>
          <p>
            Reviewed maximum:{" "}
            {plan.costDigest
              ? `USD ${Number(plan.costReview.inclusiveMaxMicroUsd) / 1000000} inclusive`
              : "Unpriced — start blocked"}
          </p>
          {plan.state === "prepared" && (
            <fieldset
              disabled={busy || !plan.costDigest || Boolean(report.blocker)}
            >
              <p>To authorize exactly one paid task, type:</p>
              <code style={{ overflowWrap: "anywhere" }}>{approval}</code>
              <br />
              <input
                aria-label="One paid task confirmation"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                style={{ width: "100%" }}
              />
              <button
                type="button"
                disabled={phrase !== approval}
                onClick={() => action("start")}
              >
                Start ONE paid generation
              </button>
            </fieldset>
          )}
          {["submitted", "processing"].includes(plan.state) && (
            <>
              <button
                disabled={busy || Boolean(report.blocker)}
                onClick={() => action("poll")}
              >
                Check provider status / resume same task
              </button>
              <button
                disabled={busy || Boolean(report.blocker)}
                onClick={() => {
                  if (
                    window.confirm(
                      "Request cancellation of this same task only if still queued? Cancellation may be uncertain.",
                    )
                  )
                    void action("cancel");
                }}
              >
                Cancel if still queued
              </button>
              <p>
                Check status periodically. No background polling is started.
                Never resubmit after a timeout; refresh saved status and resume
                the saved task.
              </p>
            </>
          )}
          {plan.outputReview && (
            <details open={plan.state === "output_observed"}>
              <summary>3. Approve output and save MP4</summary>
              <p>
                Observed hostname: {plan.observedHostname || "Not yet returned"}
                . This is evidence only, not approval. URLs expire after about
                one hour. Review the exact hostname and bounded dimensions, FPS,
                duration and codecs; use acknowledgment
                APPROVE_EXACT_HOST_AND_MEDIA_POLICY.
              </p>
              <fieldset disabled={busy}>
                <ReviewFields value={output} setValue={setOutput} />
                <button
                  onClick={() =>
                    request({
                      action: "output-review",
                      plan: plan.id,
                      review: output,
                    })
                  }
                >
                  Validate and save output review — offline
                </button>
              </fieldset>
              <label>
                <input
                  type="checkbox"
                  checked={downloadApproval}
                  onChange={(e) => setDownloadApproval(e.target.checked)}
                />{" "}
                I approve fetching this same task’s result under the saved
                host/media policy.
              </label>
              <br />
              <button
                disabled={
                  busy ||
                  !downloadApproval ||
                  !plan.outputDigest ||
                  plan.state !== "output_observed" ||
                  Boolean(report.blocker)
                }
                onClick={() => action("download")}
              >
                Retrieve and validate MP4 — no new generation
              </button>
              {plan.state === "output_observed" && (
                <button
                  disabled={busy || Boolean(report.blocker)}
                  onClick={() => action("refresh")}
                >
                  Refresh same-task output URL
                </button>
              )}
            </details>
          )}
          {plan.completed && (
            <>
              <video
                controls
                preload="metadata"
                src={media("video")}
                style={{ maxWidth: "100%", width: 640 }}
              />
              <p>
                <a href={`${media("video")}&download=1`}>
                  Download private MP4
                </a>
              </p>
            </>
          )}
          {["completed", "failed", "uncertain", "output_observed"].includes(
            plan.state,
          ) && (
            <button
              disabled={busy || Boolean(report.blocker)}
              onClick={() => action("cleanup")}
            >
              Clean recorded R2 inputs after lease expiry
            </button>
          )}
        </>
      )}
      {busy && (
        <p role="status">
          Working. Do not repeat the request. A lost response does not authorize
          another submission.
        </p>
      )}
    </section>
  );
}
