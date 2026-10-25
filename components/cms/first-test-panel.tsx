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
  validatedMedia?: Record<string, string | number> | null;
};
type Report = {
  plan: Plan | null;
  blocker: string | null;
  startBlockers?: string[];
  discoveryBlockers?: string[];
  budget?: {
    currency: "USD";
    capMicroUsd: number | null;
    reservedMicroUsd: number | null;
    unreservedMicroUsd: number | null;
    actualPreviousChargeMicroUsd: null;
    eurBudgetVerified: boolean;
  };
  reconciliationRequired?: boolean;
};
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
  "reviewedBy",
  "reviewedAt",
  "acknowledgment",
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
        .filter(
          ([key]) =>
            !bindings.has(key) &&
            !(
              value.kind === "first-test-output-discovery-v1" &&
              [
                "width",
                "height",
                "fps",
                "videoCodec",
                "audioCodec",
                "minDurationSeconds",
                "maxDurationSeconds",
              ].includes(key)
            ) &&
            !(
              value.acknowledgment ===
                "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT" &&
              [
                "baseMaxMicroUsd",
                "taxMaxMicroUsd",
                "feesMaxMicroUsd",
                "inclusiveMaxMicroUsd",
              ].includes(key)
            ),
        )
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
  const [discovery, setDiscovery] = useState(false);
  const blockers = discovery
    ? (report.discoveryBlockers ?? report.startBlockers)
    : report.startBlockers;
  const plan = report.plan;
  async function request(
    body?: Record<string, unknown> | FormData,
    existingPlan?: string,
  ) {
    setBusy(true);
    setError("");
    setPrepared("");
    try {
      const response = await fetch(
        existingPlan
          ? `${endpoint}?plan=${encodeURIComponent(existingPlan)}`
          : endpoint,
        {
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
        },
      );
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
      discovery,
    });
  const media = (kind: string) =>
    `${endpoint}?plan=${encodeURIComponent(plan!.id)}&media=${kind}`;
  const approval = plan
    ? `AUTHORIZE ONE PAID BYTEPLUS TEST ${plan.id} UP TO ${plan.costReview.inclusiveMaxMicroUsd} MICROUSD${discovery ? " DISCOVER OUTPUT ONLY" : ""}`
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
      {report.budget && (
        <section aria-label="Test spending reservations">
          <h3>Cumulative test budget (USD)</h3>
          <p>
            Configured cap:{" "}
            {report.budget.capMicroUsd === null
              ? "Not configured/invalid"
              : `USD ${report.budget.capMicroUsd / 1000000}`}{" "}
            · Reserved:{" "}
            {report.budget.reservedMicroUsd === null
              ? "Unavailable"
              : `USD ${report.budget.reservedMicroUsd / 1000000}`}{" "}
            · Unreserved cap:{" "}
            {report.budget.unreservedMicroUsd === null
              ? "Unknown"
              : `USD ${report.budget.unreservedMicroUsd / 1000000}`}
          </p>
          <p>
            These are application spending reservations, not settled BytePlus
            charges or an account balance. EUR 50 is a total budget, not a
            verified USD conversion. No failed-task refund or zero charge is
            assumed.
          </p>
          {report.reconciliationRequired && (
            <p role="status">
              Second test is blocked. Obtain BytePlus confirmation of the
              previous task’s final state and final inclusive charges (or a
              confirmed zero charge/refund), with dated support/billing
              references and currency. HTTP 500 / 50510 is not reconciliation.
              Keep the existing task, slot and reservation; do not prepare a
              replacement or increase caps to work around the block. Separate
              second-test authorization is not implemented until that evidence
              is verified.
            </p>
          )}
        </section>
      )}
      {report.blocker && (
        <p role="status" style={{ whiteSpace: "pre-wrap" }}>
          {report.blocker}
        </p>
      )}
      {!!blockers?.length && (
        <details open>
          <summary>Requirements blocking a paid start</summary>
          <ul>
            {blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <button type="button" disabled={busy} onClick={() => request()}>
        Refresh saved status
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const id = String(
            new FormData(e.currentTarget).get("existingPlan") || "",
          ).trim();
          if (id) void request(undefined, id);
        }}
      >
        <label>
          Existing prepared plan ID{" "}
          <input
            name="existingPlan"
            aria-label="Existing prepared plan ID"
            required
            pattern="[a-zA-Z0-9_-]{1,100}"
          />
        </label>
        <button type="submit" disabled={busy}>
          Load owned plan — no upload
        </button>
      </form>
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
              Provider rate: USD 0.07 per generated video second before tax.
              Illustrative base estimate: USD 0.28–0.42 for a 4–6 second
              generated video. This is not a quote or an inclusive maximum for
              this clip. Tax, fees and EUR/USD conversion remain unverified.
            </p>
            <p>
              A EUR 50 budget is permission to spend, not evidence of provider
              charges or a USD exchange rate. Evidence must support the
              generated-duration bound and an inclusive USD maximum within your
              authorized budget. Reviewer and review time are recorded from your
              authenticated session.
            </p>
            <fieldset disabled={busy || plan.state !== "prepared"}>
              <label>
                <input
                  type="checkbox"
                  checked={
                    cost.acknowledgment ===
                    "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT"
                  }
                  onChange={(e) =>
                    setCost({
                      ...cost,
                      acknowledgment: e.target.checked
                        ? "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT"
                        : "",
                      baseMaxMicroUsd: null,
                      taxMaxMicroUsd: null,
                      feesMaxMicroUsd: null,
                    })
                  }
                />{" "}
                Use one evidence-backed inclusive USD maximum; leave unverified
                tax/fee amounts unknown.
              </label>
              {cost.acknowledgment ===
                "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT" && (
                <label style={{ display: "block" }}>
                  Inclusive maximum (USD, not EUR)
                  <input
                    aria-label="Inclusive maximum USD"
                    type="text"
                    inputMode="decimal"
                    key={`${plan.id}:${plan.costDigest}`}
                    defaultValue={
                      cost.inclusiveMaxMicroUsd == null
                        ? ""
                        : Number(cost.inclusiveMaxMicroUsd) / 1000000
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) setCost({ ...cost, inclusiveMaxMicroUsd: null });
                      else if (/^\d+(\.\d{0,6})?$/.test(v)) {
                        const [whole, fraction = ""] = v.split(".");
                        setCost({
                          ...cost,
                          inclusiveMaxMicroUsd: Number(
                            whole + fraction.padEnd(6, "0"),
                          ),
                        });
                      } else setCost({ ...cost, inclusiveMaxMicroUsd: null });
                    }}
                  />
                </label>
              )}
              <ReviewFields value={cost} setValue={setCost} />
              <button
                type="button"
                onClick={() =>
                  request({
                    action: "cost-review",
                    plan: plan.id,
                    review: {
                      ...cost,
                      acknowledgment:
                        cost.acknowledgment ===
                        "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT"
                          ? cost.acknowledgment
                          : "INCLUSIVE_BOUND_FOR_EXACT_INPUT",
                    },
                  })
                }
              >
                Approve evidence-backed cost review — offline
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
            <label>
              <input
                type="checkbox"
                checked={discovery}
                onChange={(e) => {
                  setDiscovery(e.target.checked);
                  setPhrase("");
                }}
              />{" "}
              First-test discovery: submit and poll this one task without
              pre-approved output metadata. No provider video is fetched until I
              separately approve its exact host and a bounded media policy.
            </label>
          )}
          {plan.state === "prepared" && (
            <fieldset
              disabled={
                busy ||
                !plan.costDigest ||
                (!discovery && !plan.outputDigest) ||
                Boolean(report.blocker) ||
                Boolean(blockers?.length)
              }
            >
              <label>
                <input
                  type="checkbox"
                  aria-label="One paid task confirmation"
                  checked={phrase === approval}
                  onChange={(e) => setPhrase(e.target.checked ? approval : "")}
                />{" "}
                I authorize exactly ONE paid task for plan {plan.id}, up to USD{" "}
                {Number(plan.costReview.inclusiveMaxMicroUsd) / 1000000}{" "}
                inclusive, using the saved cost approval and{" "}
                {discovery
                  ? "discovery-only mode; download remains separately gated"
                  : "saved output approval"}
                .
              </label>
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
              <summary>
                3. Approve output policy before start / save MP4
              </summary>
              <p>
                Observed hostname: {plan.observedHostname || "Not yet returned"}
                . This is evidence only, not approval. URLs expire after about
                one hour. Review the exact hostname and bounded dimensions, FPS,
                duration and codecs. Support confirms 720p; exact dimensions,
                frame rate and codecs are not verified and are not auto-filled.
                The reported v16m-default.tiktokcdn.com remains a candidate
                until explicitly approved with evidence. Reviewer and time are
                recorded automatically.
              </p>
              <fieldset disabled={busy}>
                <label>
                  <input
                    type="checkbox"
                    checked={output.kind === "first-test-output-discovery-v1"}
                    onChange={(e) =>
                      setOutput({
                        ...output,
                        kind: e.target.checked
                          ? "first-test-output-discovery-v1"
                          : "first-test-output-review-v1",
                        width: null,
                        height: null,
                        fps: null,
                        videoCodec: "",
                        audioCodec: "",
                        minDurationSeconds: e.target.checked ? 1 : null,
                        maxDurationSeconds: e.target.checked
                          ? plan.costReview.generatedVideoMaxSeconds
                          : null,
                      })
                    }
                  />{" "}
                  Discover actual metadata under a strict acceptance policy:
                  720p (short side), dimensions ≤4096, 0–120 fps, H.264/HEVC
                  video + AAC audio, 1 second through the approved duration
                  bound. These are acceptance rules, not claims about unverified
                  provider metadata. The exact host still requires explicit
                  review.
                </label>
                <ReviewFields value={output} setValue={setOutput} />
                <button
                  onClick={() =>
                    request({
                      action: "output-review",
                      plan: plan.id,
                      review: {
                        ...output,
                        acknowledgment: "APPROVE_EXACT_HOST_AND_MEDIA_POLICY",
                      },
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
              {plan.validatedMedia && (
                <p>
                  Validated MP4 metadata: {JSON.stringify(plan.validatedMedia)}
                </p>
              )}
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
