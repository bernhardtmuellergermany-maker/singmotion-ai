"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ensureSession } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
import type { StudioProject } from "@/lib/live/studio";
import { StudioRecordingReview } from "./studio-recording-review";
import { StudioBudgetReview } from "./studio-budget";
import type { offerStudioBudget } from "@/lib/live/studio-budget-review";
// Explicit field order: object insertion order is not selection identity.
function selectionIdentity(s: StudioDraftExport | null) {
  return s
    ? JSON.stringify([
        s.version,
        s.owner,
        s.songId,
        s.imageId,
        s.start,
        s.end,
        s.performance,
        s.camera,
        s.customPrompt,
        s.outputFormat || null,
      ])
    : "null";
}
function reviewIdentity(p: StudioProject, termsVersion?: string) {
  return JSON.stringify([
    p.id,
    p.digest,
    p.ceilingMicroUsd,
    selectionIdentity(p.selection),
    p.experimental,
    p.prompt,
    p.durationSeconds,
    termsVersion || "",
  ]);
}
const receiptKey = "singmotion-private-review-v1";
const usd = (micro: number) => `USD ${(micro / 1000000).toFixed(2)}`;
export function StudioLiveControl({
  selection,
  artistName,
  consent,
  termsVersion,
  disabled,
  disabledReason,
}: {
  selection: StudioDraftExport | null;
  artistName: string;
  consent: boolean;
  termsVersion?: string;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [available, setAvailable] = useState(false),
    [pilot, setPilot] = useState(false),
    [budget, setBudget] = useState<
      Awaited<ReturnType<typeof offerStudioBudget>>["budget"] | null
    >(null),
    [blockers, setBlockers] = useState<string[]>([]),
    [reviewedPlan, setPlan] = useState<StudioProject | null>(null),
    [error, setError] = useState(""),
    [recordingNotice, setRecordingNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [english, setEnglish] = useState(false),
    [confirmed, setConfirmed] = useState<string | null>(null);
  const router = useRouter();
  const selectionKey = selectionIdentity(selection);
  const currentSelection = useRef(selectionKey);
  const reviewRevision = useRef(0);
  useEffect(() => {
    currentSelection.current = selectionKey;
  }, [selectionKey]);
  useEffect(() => {
    let current = true;
    const revision = ++reviewRevision.current;
    void ensureSession()
      .then(async () => {
        const raw = sessionStorage.getItem(receiptKey);
        if (!raw) return;
        const receipt = JSON.parse(raw);
        if (
          receipt.selection !== selectionKey ||
          typeof receipt.id !== "string"
        )
          return;
        // Restore only from the authenticated server, never a cached project snapshot.
        const saved = await api<StudioProject>(
          `studio-live?id=${encodeURIComponent(receipt.id)}`,
        );
        if (
          !current ||
          revision !== reviewRevision.current ||
          selectionIdentity(saved.selection) !== selectionKey
        )
          return;
        setPlan(saved);
        setEnglish(receipt.english === true);
        setConfirmed(
          receipt.approval === reviewIdentity(saved, termsVersion)
            ? receipt.approval
            : null,
        );
      })
      .catch(() => {
        if (current)
          setError(
            "Saved review could not be refreshed. Review real video cost to reload the existing project; no generation was started.",
          );
      });
    return () => {
      current = false;
    };
  }, [selectionKey, termsVersion]);
  function saveReceipt(
    p: StudioProject,
    approval: string | null,
    englishConfirmed = english,
  ) {
    try {
      sessionStorage.setItem(
        receiptKey,
        JSON.stringify({
          id: p.id,
          selection: selectionIdentity(p.selection),
          approval,
          english: englishConfirmed,
        }),
      );
    } catch {
      /* In-memory review still works when browser storage is unavailable. */
    }
  }
  const refreshReadiness = useCallback(async () => {
    await ensureSession();
    const r = await api<{
      available: boolean;
      pilot?: boolean;
      blockers: string[];
      budget?: Awaited<ReturnType<typeof offerStudioBudget>>["budget"] | null;
    }>("studio-live");
    setAvailable(r.available);
    setPilot(r.pilot === true);
    setBlockers(r.blockers || []);
    setBudget(r.budget || null);
  }, []);
  useEffect(() => {
    void ensureSession()
      .then(refreshReadiness)
      .catch(() => {});
  }, [refreshReadiness]);
  const plan =
    reviewedPlan && selectionIdentity(reviewedPlan.selection) === selectionKey
      ? reviewedPlan
      : null;
  const approvalKey = plan ? reviewIdentity(plan, termsVersion) : null;
  const isConfirmed = approvalKey !== null && confirmed === approvalKey;
  const generateReasons = [
    busy && "A Studio operation is still running. Wait for it to finish.",
    !available &&
      (blockers.join(" ") ||
        "Pilot readiness has not been verified. Refresh Studio."),
    disabled &&
      (disabledReason ||
        "Finish the upload and select a valid audio excerpt and prompt."),
    !consent && "Confirm rights for this selection and the current Terms.",
    !english && "Confirm that the composed prompt is English.",
    !plan &&
      (reviewedPlan
        ? "Selection changed. Review real video cost for the current selection."
        : "Review real video cost to load a prepared project."),
    plan &&
      plan.state !== "prepared" &&
      `Project is ${plan.state}; use its saved project for status or recovery. Do not resubmit.`,
    plan?.providerJobId &&
      "This project already has a provider task. Open the saved project to recover it.",
    plan &&
      !plan.digest &&
      "The project has no reviewed policy digest. Review real video cost again.",
    plan &&
      (plan.ceilingMicroUsd === null ||
        !Number.isSafeInteger(plan.ceilingMicroUsd) ||
        plan.ceilingMicroUsd <= 0) &&
      "A valid reviewed spending ceiling is required.",
    plan &&
      !plan.budget &&
      (plan.budgetBlocker ||
        "Current budget authorization is unavailable. Review / renew EUR 50 budget."),
    plan?.budget && plan.budgetBlocker,
    plan?.budget &&
      plan.ceilingMicroUsd !== null &&
      plan.budget.remainingMicroUsd < plan.ceilingMicroUsd &&
      "Remaining cumulative budget is below this project's spending ceiling. Existing reservations remain counted.",
    plan &&
      !isConfirmed &&
      "Approve one paid generation of this exact reviewed project and spending ceiling below.",
  ].filter(
    (reason): reason is string => typeof reason === "string" && !!reason,
  );
  if (!pilot) return null;
  async function prepare(repeatOf?: string) {
    ++reviewRevision.current;
    setBusy(true);
    setError("");
    setRecordingNotice("");
    try {
      const result = await api<StudioProject>("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "prepare",
          selection,
          artistName,
          consent,
          termsVersion,
          english,
          ...(repeatOf ? { repeatOf } : {}),
        }),
      });
      if (currentSelection.current !== selectionKey) return;
      const approval =
        confirmed === reviewIdentity(result, termsVersion) ? confirmed : null;
      setPlan(result);
      setConfirmed(approval);
      saveReceipt(result, approval);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!plan || generateReasons.length) return;
    ++reviewRevision.current;
    setBusy(true);
    setError("");
    try {
      await api("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          consent,
          termsVersion,
          id: plan.id,
          digest: plan.digest,
          ceilingMicroUsd: plan.ceilingMicroUsd,
          confirmation: `CONFIRM PAID STUDIO ${plan.id} ${plan.digest} ${plan.ceilingMicroUsd}${plan.experimental ? " ACCEPT EXPERIMENTAL UNKNOWN DURATION FEES MEDIA" : ""}`,
        }),
      });
      router.push(`/projects/live_${plan.id}`);
    } catch (e) {
      setConfirmed(null);
      if (plan) saveReceipt(plan, null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Real video pilot" className="prompt-preview">
      <h3>OmniHuman 2.0 · administrator pilot</h3>
      <p>
        Real provider charges. Choose 4–60 seconds within the reviewed duration
        bands. No customer credit or payment integration.
      </p>
      {blockers.map((b) => (
        <p role="status" key={b}>
          {b}
        </p>
      ))}
      <StudioBudgetReview
        budget={budget}
        onSaved={async () => {
          setAvailable(false);
          setPlan(null);
          setConfirmed(null);
          await refreshReadiness();
        }}
      />
      <label className="consent">
        <input
          type="checkbox"
          checked={english}
          disabled={busy}
          onChange={(e) => {
            setEnglish(e.target.checked);
            if (plan) saveReceipt(plan, confirmed, e.target.checked);
          }}
        />
        The composed prompt is English.
      </label>
      <button
        className="button outline"
        disabled={
          !available ||
          busy ||
          disabled ||
          !selection ||
          selection.end - selection.start < 4 ||
          selection.end - selection.start > 60 ||
          !consent ||
          !english
        }
        onClick={() => void prepare()}
      >
        Review real video cost — no paid request
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {recordingNotice && <p role="status">{recordingNotice}</p>}
      {selection && error.includes("[TEMPO_IDENTITY_REVIEW_REQUIRED]") && (
        <StudioRecordingReview
          key={selectionKey}
          selection={selection}
          consent={consent}
          termsVersion={termsVersion}
          onSaved={(message) => {
            setError("");
            setRecordingNotice(message);
            setPlan(null);
            setConfirmed(null);
          }}
        />
      )}
      {generateReasons.length > 0 && (
        <div
          id="studio-generate-blockers"
          role="status"
          aria-label="Generation blockers"
        >
          <strong>Generate is unavailable:</strong>
          <ul>
            {generateReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {plan && (
        <>
          {plan.budget && (
            <p>
              EUR 50 total authorization · remaining EUR{" "}
              {(plan.budget.remainingMicroEur / 1000000).toFixed(2)} under{" "}
              {plan.budget.basis} conversion terms. All prior reservations
              retained. Remaining cumulative USD allowance:{" "}
              {usd(plan.budget.remainingMicroUsd)}. This is not a settled
              balance or bank-fee guarantee.
            </p>
          )}
          {plan.overlapExposure && (
            <p role="alert">
              A historical task has an acknowledged private-test exception, not
              a verified terminal outcome. Overlapping generation and billing
              remain possible; its full reservation is included in your
              cumulative budget.
            </p>
          )}
          {plan.budgetBlocker && <p role="alert">{plan.budgetBlocker}</p>}
          {["completed", "failed"].includes(plan.state) && (
            <button
              className="button outline"
              disabled={busy || disabled || !consent || !english}
              onClick={() => void prepare(plan.id)}
            >
              Review another test of this selection — no paid request
            </button>
          )}
          <p role="status">{plan.stage}</p>
          <p>
            Review {plan.id} · policy digest{" "}
            {plan.digest?.slice(0, 12) || "unpriced"}
          </p>
          <p>Measured MP3: {plan.durationSeconds.toFixed(3)}s</p>
          <p>{plan.prompt}</p>
          <p>
            Input-length estimate: {usd(plan.estimatedBaseMicroUsd)} before
            tax/fees. Actual billing uses generated video seconds.
          </p>
          <p>
            {plan.planningUpliftMicroUsd != null && (
              <>
                Provisional planning estimate with 19% uplift:{" "}
                {usd(plan.planningUpliftMicroUsd)}. This is NOT verified
                BytePlus tax and does not establish an inclusive charge.
                <br />
              </>
            )}
            {plan.experimental
              ? "Experimental planning reservation (not a guaranteed charge): "
              : "Reviewed reservation ceiling: "}
            {plan.ceilingMicroUsd === null
              ? "Unavailable"
              : usd(plan.ceilingMicroUsd)}
            . No automatic refund or retry.
          </p>
          <Link href={`/projects/live_${plan.id}`}>Saved private project</Link>
          {plan.state === "prepared" && (
            <>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={isConfirmed}
                  disabled={busy}
                  onChange={(e) => {
                    ++reviewRevision.current;
                    const approval = e.target.checked ? approvalKey : null;
                    setConfirmed(approval);
                    saveReceipt(plan, approval);
                  }}
                />
                {plan.experimental
                  ? "I explicitly approve one experimental paid generation and this finite budget reservation. Generated duration, fees and media properties are unknown; actual provider charges are not guaranteed by the reservation. Out-of-bounds output will be rejected without refund or automatic retry."
                  : "I explicitly approve one paid generation of this exact reviewed selection up to this ceiling."}
              </label>
              <button
                className="button primary"
                disabled={generateReasons.length > 0}
                aria-describedby="studio-generate-blockers"
                onClick={() => void submit()}
              >
                Generate ONE real video
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
export function LiveProject({ id }: { id: string }) {
  const router = useRouter();
  const [project, setProject] = useState<StudioProject | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const read = () =>
      ensureSession()
        .then(() =>
          api<StudioProject>(`studio-live?id=${encodeURIComponent(id)}`),
        )
        .then((p) => {
          if (active) setProject(p);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (document.visibilityState !== "hidden") await read();
      if (active) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  async function poll() {
    setBusy(true);
    setError("");
    try {
      setProject(
        await api<StudioProject>("studio-live", {
          method: "POST",
          body: JSON.stringify({ action: "poll", id }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string, extra: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const updated = await api<StudioProject>("studio-live", {
        method: "POST",
        body: JSON.stringify({ action, id, ...extra }),
      });
      setProject(updated);
      if (action === "hide") router.push("/projects");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div id="content">
      <div className="page-heading">
        <h1>
          {project?.outputReady
            ? "Your video is ready."
            : "Your OmniHuman project"}
        </h1>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {project && (
        <div className="result-layout">
          <div className="content-card">
            <p role="status">{project.stage}</p>
            {project.outputReady ? (
              <>
                <video
                  className="result-player"
                  controls
                  playsInline
                  src={`/api/studio-live?id=${id}&video=1`}
                />
                <a
                  className="button primary"
                  href={`/api/studio-live?id=${id}&video=1&download=1`}
                  download
                >
                  Download MP4
                </a>
              </>
            ) : (
              <>
                <p>
                  No new task is submitted when checking status. Background
                  retrieval requires the recovery worker; resume this task
                  promptly within the provider URL lifetime.
                </p>
                <button
                  className="button outline"
                  disabled={
                    busy || !["submitted", "processing"].includes(project.state)
                  }
                  onClick={() => void poll()}
                >
                  Resume status / retrieve same task
                </button>
              </>
            )}
          </div>
          <div className="content-card">
            <h2>{project.artistName}</h2>
            <p>
              {project.durationSeconds.toFixed(3)}s MP3 · {project.state}
            </p>
            <p>{project.prompt}</p>
            <p>
              Reservation:{" "}
              {project.ceilingMicroUsd === null
                ? "Unpriced"
                : usd(project.ceilingMicroUsd)}
              ; actual invoice not yet reconciled.
            </p>
            {project.experimental && (
              <p role="alert">
                Experimental planning policy: duration, fees and media
                properties are unknown. The reservation is not a guaranteed
                inclusive charge. Strict output validation and no automatic paid
                retries still apply.
              </p>
            )}
            <p>Provider task: {project.providerJobId || "Not assigned"}</p>
            {project.hidden ? (
              <p>
                Hidden from My Projects. This saved link still provides
                recovery; locks and reservations are unchanged.
              </p>
            ) : (
              <button
                className="button outline"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Hide project from My Videos? Files, billing records and active task locks are retained. Save this page link for recovery.",
                    )
                  )
                    void action("hide", { confirmation: `HIDE ${id}` });
                }}
              >
                Hide project
              </button>
            )}
            {project.providerJobId &&
              ["submitted", "processing"].includes(project.state) && (
                <details>
                  <summary>
                    Operator: reconcile a confirmed terminal task
                  </summary>
                  <p>
                    50510 alone does not prove this task ended. Verify and
                    retain a BytePlus support response explicitly confirming
                    this task is terminal. Reservations remain fully counted.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const fields = new FormData(event.currentTarget);
                      if (
                        !window.confirm(
                          "Record verified provider evidence and release only this task's active-generation lock? Its full reservation remains.",
                        )
                      )
                        return;
                      void action("reconcile", {
                        evidence: {
                          taskId: project.providerJobId,
                          outcome: fields.get("outcome"),
                          reference: fields.get("reference"),
                          sha256: fields.get("sha256"),
                          verified: fields.get("verified") === "on",
                          confirmation: `RECONCILE ${id} ${project.providerJobId}`,
                        },
                      });
                    }}
                  >
                    <label>
                      Provider-confirmed outcome
                      <select name="outcome" required>
                        <option value="rejected">Rejected</option>
                        <option value="failed">Failed</option>
                        <option value="canceled">Canceled</option>
                      </select>
                    </label>
                    <label>
                      Support case / evidence reference (no secrets)
                      <input
                        name="reference"
                        required
                        minLength={8}
                        maxLength={200}
                      />
                    </label>
                    <label>
                      SHA-256 of retained provider response
                      <input name="sha256" required pattern="[a-f0-9]{64}" />
                    </label>
                    <label>
                      <input type="checkbox" name="verified" required />I
                      verified this evidence explicitly confirms the displayed
                      task is terminal; an HTTP error alone is insufficient.
                    </label>
                    <button className="button outline" disabled={busy}>
                      Record terminal reconciliation
                    </button>
                  </form>
                </details>
              )}
            <Link href="/studio">Back to Studio</Link>
          </div>
        </div>
      )}
    </div>
  );
}
export function LiveProjects() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [pilot, setPilot] = useState(false),
    [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        await ensureSession();
        if (document.visibilityState !== "hidden") {
          const r = await api<{ projects: StudioProject[]; pilot?: boolean }>(
            "studio-live",
          );
          if (active) {
            setProjects(r.projects || []);
            setPilot(!!r.pilot);
          }
        }
      } catch {
        /* Login/access remains separate; no provider request occurs here. */
      }
      if (active) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  if (!pilot) return null;
  return (
    <section aria-label="OmniHuman projects" className="project-grid">
      {error && <p role="alert">{error}</p>}
      {projects.map((p) => (
        <div key={p.id}>
          <Link href={`/projects/live_${p.id}`} className="project-card">
            <div className="project-cover">
              <img
                src={`/api/assets/${p.imageId}`}
                alt={`${p.artistName} reference`}
              />
              <span className="job-badge">{p.state}</span>
            </div>
            <div className="project-info">
              <h3>{p.artistName}</h3>
              <p>
                {p.selection.outputFormat || "Original format"} ·{" "}
                {p.durationSeconds.toFixed(2)}s ·{" "}
                {new Date(p.createdAt).toLocaleDateString("en-GB")}
              </p>
              <p>Base estimate: {usd(p.estimatedBaseMicroUsd)}</p>
              <p>
                {p.ceilingMicroUsd === null
                  ? "Unpriced"
                  : `${usd(p.ceilingMicroUsd)} reserved ceiling`}
              </p>
            </div>
          </Link>
          <button
            className="button outline"
            disabled={busy !== null}
            onClick={async () => {
              if (
                !window.confirm(
                  "Hide project from My Videos? Task history, files, reservations and unresolved locks are retained.",
                )
              )
                return;
              setBusy(p.id);
              setError("");
              try {
                await api("studio-live", {
                  method: "POST",
                  body: JSON.stringify({
                    action: "hide",
                    id: p.id,
                    confirmation: `HIDE ${p.id}`,
                  }),
                });
                setProjects((items) =>
                  items.filter((item) => item.id !== p.id),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            Hide project
          </button>
        </div>
      ))}
    </section>
  );
}
