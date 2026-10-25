"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ensureSession } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
import type { StudioWorkflow, StudioProject } from "@/lib/live/studio";
const usd = (micro: number) => `USD ${(micro / 1000000).toFixed(2)}`;
export function StudioLiveControl({
  selection,
  artistName,
  consent,
  disabled,
}: {
  selection: StudioDraftExport | null;
  artistName: string;
  consent: boolean;
  disabled: boolean;
}) {
  const [available, setAvailable] = useState(false),
    [pilot, setPilot] = useState(false),
    [blockers, setBlockers] = useState<string[]>([]),
    [reviewedPlan, setPlan] = useState<StudioProject | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [english, setEnglish] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const router = useRouter();
  useEffect(() => {
    void ensureSession()
      .then(() =>
        api<{ available: boolean; pilot?: boolean; blockers: string[] }>(
          "studio-live",
        ),
      )
      .then((r) => {
        setAvailable(r.available);
        setPilot(r.pilot === true);
        setBlockers(r.blockers || []);
      })
      .catch(() => {});
  }, []);
  const selectionKey = JSON.stringify(selection);
  const plan =
    reviewedPlan && JSON.stringify(reviewedPlan.selection) === selectionKey
      ? reviewedPlan
      : null;
  if (!pilot) return null;
  async function prepare(repeatOf?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<StudioProject>("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "prepare",
          selection,
          artistName,
          consent,
          english,
          ...(repeatOf ? { repeatOf } : {}),
        }),
      });
      setPlan(result);
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!plan || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      await api("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          id: plan.id,
          digest: plan.digest,
          ceilingMicroUsd: plan.ceilingMicroUsd,
          confirmation: `CONFIRM PAID STUDIO ${plan.id} ${plan.digest} ${plan.ceilingMicroUsd}`,
        }),
      });
      router.push(`/projects/live_${plan.id}`);
    } catch (e) {
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
      <label className="consent">
        <input
          type="checkbox"
          checked={english}
          onChange={(e) => setEnglish(e.target.checked)}
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
              Task 176942047 has an acknowledged private-test exception, not a
              verified terminal outcome. Overlapping generation and billing
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
            Reviewed reservation ceiling:{" "}
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
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I explicitly approve one paid generation of this exact reviewed
                selection up to this ceiling.
              </label>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !confirmed ||
                  !consent ||
                  !english ||
                  disabled ||
                  !plan.digest ||
                  !plan.budget ||
                  (plan.budget?.remainingMicroUsd ?? 0) <
                    (plan.ceilingMicroUsd ?? 0) ||
                  plan.ceilingMicroUsd === null ||
                  JSON.stringify(plan.selection) !== selectionKey
                }
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
function FreshTest() {
  const [result, setResult] = useState<Awaited<
    ReturnType<StudioWorkflow["freshTest"]>
  > | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <button
        className="button outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setResult(null);
          try {
            await ensureSession();
            setResult(
              await api("studio-live", {
                method: "POST",
                body: JSON.stringify({ action: "fresh-test" }),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking previous tasks…" : "Start fresh test"}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div role="status">
          {result.ready ? (
            <p>
              {result.exceptionExposure
                ? "Private-test exception acknowledged. The old task is still unresolved; overlapping generation and billing remain possible."
                : "No unresolved task blocks this check."}{" "}
              Reservations remain counted.{" "}
              <Link href="/studio">
                Open Studio to select inputs and explicitly approve a new test
              </Link>
              . Spending and active-task checks run again before submission.
            </p>
          ) : (
            result.blockers.map((b, i) => (
              <p key={i}>
                {b.message}{" "}
                {b.projectId && (
                  <Link href={`/projects/live_${b.projectId}`}>
                    Recover / reconcile previous task
                  </Link>
                )}
              </p>
            ))
          )}
        </div>
      )}
    </div>
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
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
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
                      "Delete project from My Projects? Files, billing records and active task locks are retained. Save this page link for recovery.",
                    )
                  )
                    void action("hide", { confirmation: `HIDE ${id}` });
                }}
              >
                Delete project
              </button>
            )}
            {project.providerJobId &&
              ["submitted", "processing"].includes(project.state) && (
                <details>
                  <summary>
                    Super Admin: reconcile a confirmed terminal task
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
            {project.providerJobId === "176942047" &&
              ["submitted", "processing", "uncertain"].includes(
                project.state,
              ) &&
              (project.privateException ? (
                <p role="status">
                  Private-test exception recorded. Old task outcome remains
                  unverified; its full reservation and possible overlapping
                  billing remain.
                </p>
              ) : (
                <div>
                  <p>
                    For task 176942047 only: if the retained response cannot
                    establish terminal rejection, a Super Admin may accept
                    possible overlapping generation and billing. This does not
                    mark the task terminal or refund its reservation.
                  </p>
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "I accept possible overlapping generation and billing for unresolved task 176942047. Preserve its full reservation within EUR 50. Permit separately approved private tests without claiming this task is terminal?",
                        )
                      )
                        void action("acknowledge-private-risk", {
                          confirmation: `ACCEPT OVERLAPPING BILLING ${id} 176942047`,
                        });
                    }}
                  >
                    Acknowledge unresolved-task risk — permit private testing
                  </button>
                </div>
              ))}
            <FreshTest />
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
    void ensureSession()
      .then(() =>
        api<{ projects: StudioProject[]; pilot?: boolean }>("studio-live"),
      )
      .then((r) => {
        setProjects(r.projects || []);
        setPilot(!!r.pilot);
      })
      .catch(() => {});
  }, []);
  if (!pilot) return null;
  return (
    <section aria-label="OmniHuman projects" className="project-grid">
      <FreshTest />
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
              <p>OmniHuman 2.0 · {p.durationSeconds.toFixed(2)}s</p>
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
                  "Delete project from My Projects? Task history, files, reservations and unresolved locks are retained.",
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
            Delete project
          </button>
        </div>
      ))}
    </section>
  );
}
