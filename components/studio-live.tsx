"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ensureSession } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
import type { StudioProject } from "@/lib/live/studio";
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
  async function prepare() {
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
      <p>Real provider charges. No customer credit or payment integration.</p>
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
          !available || busy || disabled || !selection || !consent || !english
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
          <p>Measured MP3: {plan.durationSeconds.toFixed(3)}s</p>
          <p>{plan.prompt}</p>
          <p>
            Input-length estimate: {usd(plan.estimatedBaseMicroUsd)} before
            tax/fees. Actual billing uses generated video seconds.
          </p>
          <p>
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
export function LiveProject({ id }: { id: string }) {
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
            <Link href="/studio">Back to Studio</Link>
          </div>
        </div>
      )}
    </div>
  );
}
export function LiveProjects() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  useEffect(() => {
    void ensureSession()
      .then(() => api<{ projects: StudioProject[] }>("studio-live"))
      .then((r) => setProjects(r.projects || []))
      .catch(() => {});
  }, []);
  if (!projects.length) return null;
  return (
    <section aria-label="OmniHuman projects" className="project-grid">
      {projects.map((p) => (
        <Link
          key={p.id}
          href={`/projects/live_${p.id}`}
          className="project-card"
        >
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
      ))}
    </section>
  );
}
