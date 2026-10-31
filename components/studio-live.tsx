"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ensureSession } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
import type { StudioProject } from "@/lib/live/studio";
import { StudioRecordingReview } from "./studio-recording-review";
import { StudioBudgetReview } from "./studio-budget";
import "./studio-live-preview.css";
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
    [superAdmin, setSuperAdmin] = useState(false),
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
      superAdmin?: boolean;
      pilot?: boolean;
      blockers: string[];
      budget?: Awaited<ReturnType<typeof offerStudioBudget>>["budget"] | null;
    }>("studio-live");
    setAvailable(r.available);
    setSuperAdmin(r.superAdmin === true);
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
    !superAdmin && plan &&
      !plan.budget &&
      (plan.budgetBlocker ||
        "Current budget authorization is unavailable. Review / renew EUR 50 budget."),
    !superAdmin && plan?.budget && plan.budgetBlocker,
    !superAdmin && plan?.budget &&
      plan.ceilingMicroUsd !== null &&
      plan.budget.remainingMicroUsd < plan.ceilingMicroUsd &&
      "Remaining cumulative budget is below this project's spending ceiling. Existing reservations remain counted.",
    !superAdmin && plan &&
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
      <h3>{superAdmin ? "OmniHuman 2.0 · Super Admin Studio" : "OmniHuman 2.0 · private Studio"}</h3>
      <p>
        {superAdmin ? "Super Admin generation: no internal test budget or duration-band approval. BytePlus charges still apply. Media and task safety checks remain active." : "Real provider charges. Use a reviewed duration band and the server-approved limit. Customer payment is separate."}
      </p>
      {blockers.map((b) => (
        <p role="status" key={b}>
          {b}
        </p>
      ))}
      {!superAdmin && <StudioBudgetReview
        budget={budget}
        onSaved={async () => {
          setAvailable(false);
          setPlan(null);
          setConfirmed(null);
          await refreshReadiness();
        }}
      />}
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
          selection.end - selection.start > 300 ||
          !consent ||
          !english
        }
        onClick={() => void prepare()}
      >
        {superAdmin ? "Prepare video — no provider request" : "Review real video cost — no paid request"}
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
              {!superAdmin && <label className="consent">
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
              </label>}
              <button
                className="button primary"
                disabled={generateReasons.length > 0}
                aria-describedby="studio-generate-blockers"
                onClick={() => void submit()}
              >
                {superAdmin ? "Generate video" : "Generate ONE real video"}
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
  const [editingProjectName,setEditingProjectName]=useState(false);
  const [projectLabel,setProjectLabel]=useState("");
  useEffect(()=>{try{setProjectLabel(localStorage.getItem("sm-live-project-name:"+id)||"");}catch{}},[id]);
  const saveProjectName=(name:string)=>{
    const value=name.trim().slice(0,80);
    if(!value){setEditingProjectName(false);return;}
    try{
      localStorage.setItem("sm-live-project-name:"+id,value);
      const prior=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}") as Record<string,string>;
      localStorage.setItem("sm-gallery-labels",JSON.stringify({...prior,["live_"+id]:value}));
    }catch{}
    setProjectLabel(value);setEditingProjectName(false);
  };
  const sourceTimestamp=(value:number)=>{const ms=Math.round(Math.max(0,value)*1000);return String(Math.floor(ms/60000)).padStart(2,"0")+":"+String(Math.floor((ms%60000)/1000)).padStart(2,"0")+"."+String(ms%1000).padStart(3,"0");};
  const ratio = project?.selection.outputFormat === "16:9" ? "landscape" : "portrait";
  const complete = project?.outputReady === true;
  const failed = project?.state === "failed";
  const statusLabel = complete ? "Completed" : failed ? "Failed" : project?.state === "prepared" ? "Ready to submit" : project?.state === "submitted" ? "Queued with provider" : project?.state === "processing" ? "Generating video" : "Preparing project";
  return (
    <div id="content" className="sm-live-page">
      {error && <p role="alert" className="error">{error}</p>}
      {!project ? (!error && <div className="sm-live-empty" role="status">Loading your project…</div>) : (
        <div className="sm-live-layout">
          <section className="sm-live-preview-card" aria-label="Video preview and status">
            <div className="sm-live-status" role="status" aria-live="polite"><span className={"sm-live-status-dot"+(complete?" ready":failed?" failed":"")}/><strong>{statusLabel}</strong></div>
            <div className={"sm-live-viewport "+ratio}>
              {complete ? <video controls playsInline preload="metadata" src={`/api/studio-live?id=${encodeURIComponent(id)}&video=1`} aria-label="Generated video preview"/> : <>
                <img className="sm-live-image" src={`/api/assets/${encodeURIComponent(project.imageId)}`} alt="" aria-hidden="true"/>
                <div className="sm-live-animated">
                  {!failed && <><div className="sm-live-scan"/><div className="sm-live-orbit"/></>}
                  <strong>{failed?"Generation stopped":project.state==="submitted"?"Waiting for provider":"Creating your performance"}</strong>
                  <span>{failed?"Review the project status.":"Preview will appear here when the video is ready."}</span>
                </div>
              </>}
            </div>
            {!complete && <p className="sm-live-small" role="status">{project.stage}</p>}
            <div className="sm-live-actions">
              {!complete && <button type="button" className="button outline" disabled={busy || !["submitted","processing"].includes(project.state)} onClick={()=>void poll()}>{busy?"Checking status…":"Check status / retrieve video"}</button>}
              
            </div>
            {!complete && <p className="sm-live-small">Status updates automatically from the saved project every 5 seconds while this page is visible. Checking status does not submit a new generation. Video retrieval may require the recovery worker before the provider URL expires.</p>}
          </section>
          <aside className="sm-live-details" aria-label="Project details">
            <h2 style={{marginTop:0,fontSize:21}}>Project details</h2>
            <dl>
              <div className="sm-live-meta"><dt>Project</dt><dd>{editingProjectName?<input autoFocus aria-label="Project name" maxLength={80} value={projectLabel} placeholder={project.artistName} onChange={e=>setProjectLabel(e.target.value)} onBlur={()=>saveProjectName(projectLabel||project.artistName)} onKeyDown={e=>{if(e.key==="Enter")saveProjectName(projectLabel||project.artistName);if(e.key==="Escape")setEditingProjectName(false);}}/>:<span>{projectLabel||project.artistName} <button type="button" className="sm-live-rename" onClick={()=>setEditingProjectName(true)} aria-label="Rename project">Edit</button></span>}</dd></div>
              <div className="sm-live-meta"><dt>Video format</dt><dd>{project.selection.outputFormat || "9:16"}</dd></div>
              <div className="sm-live-meta"><dt>Source audio cut</dt><dd>Start {sourceTimestamp(project.selection.start)} · End {sourceTimestamp(project.selection.end)}</dd></div>
              <div className="sm-live-meta"><dt>Audio length</dt><dd>{project.durationSeconds.toFixed(3)} seconds</dd></div>
              <div className="sm-live-meta"><dt>Status</dt><dd>{project.state}</dd></div>
              <div className="sm-live-meta"><dt>Provider task</dt><dd>{project.providerJobId||"Pending"}</dd></div>
              <div className="sm-live-meta"><dt>Costs</dt><dd>Actual costs not yet available</dd></div>
            </dl>
            <details className="sm-live-operation"><summary>Performance instructions</summary><p className="sm-live-prompt">{project.prompt}</p></details>
            {project.experimental && <p className="sm-live-small" role="alert">Experimental planning policy: duration, fees and output properties are uncertain. No automatic paid retries.</p>}
            {complete && <div className="sm-live-actions"><a className="button primary" href={`/api/studio-live?id=${encodeURIComponent(id)}&video=1&download=1`} download>Download MP4</a></div>}
          </aside>
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
