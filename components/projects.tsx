"use client";
import Link from "next/link";
import { LiveProjects, LiveProject } from "./studio-live";
import { useEffect, useState } from "react";
import {
  Download,
  Bookmark,
  ArrowRight,
  Check,
  Circle,
  FolderOpen,
} from "lucide-react";
import { api, ensureSession } from "@/lib/client";
import { money, type Job } from "@/lib/domain";
import { Mark } from "./brand";
export function Projects() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    ensureSession()
      .then(() => api<Job[]>("jobs"))
      .then(setJobs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div id="content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR COLLECTION</span>
          <h1>My projects</h1>
          <p>Every song has a story. Keep yours close.</p>
        </div>
        <Link href="/studio" className="button primary">
          Create a video <ArrowRight size={15} />
        </Link>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <LiveProjects />
      {loading ? (
        <p className="quiet">Loading your projects…</p>
      ) : jobs.length ? (
        <div className="project-grid">
          {jobs.map((j) => (
            <Link
              className="project-card"
              href={`/projects/${j.id}`}
              key={j.id}
            >
              <div className="project-cover">
                <img
                  src={`/api/assets/${j.imageId}`}
                  alt={`${j.artistName} reference`}
                />
                <span className="demo-badge">
                  Demo project · reference image
                </span>
                <span className={`job-badge ${j.status}`}>{j.status}</span>
              </div>
              <div className="project-info">
                <h3>
                  {j.artistName}
                  {j.saved ? " · Saved" : ""}
                </h3>
                <p>
                  <span>
                    {(j.end - j.start).toFixed(1)}s requested ·{" "}
                    {new Date(j.created).toLocaleDateString("en-GB")}
                  </span>
                  <span>{money(j.price)}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FolderOpen size={35} />
          <h3>Your first performance starts here.</h3>
          <p>
            Create a demo in the studio. Your project and its progress will be
            saved automatically.
          </p>
          <Link href="/studio" className="button primary">
            Open the studio <ArrowRight size={16} />
          </Link>
        </div>
      )}
    </div>
  );
}
export function Project({ id }: { id: string }) {
  return id.startsWith("live_") ? (
    <LiveProject id={id.slice(5)} />
  ) : (
    <DemoProject id={id} />
  );
}
function DemoProject({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await ensureSession();
        const j = await api<Job>(`jobs/${id}`);
        if (!alive) return;
        setJob(j);
        if (j.status === "queued" || j.status === "processing")
          timer = setTimeout(poll, 1500);
        else window.dispatchEvent(new Event("credits-changed"));
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);
  async function action(data: Record<string, boolean>) {
    setSaving(true);
    try {
      setJob(
        await api<Job>(`jobs/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      );
      window.dispatchEvent(new Event("credits-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div id="content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PERFORMANCE</span>
          <h1>
            {job?.status === "completed"
              ? "Your demo is ready."
              : job?.status === "failed"
                ? "Let’s try another take."
                : job?.status === "cancelled"
                  ? "Generation cancelled."
                  : "Setting the stage."}
          </h1>
          <p>
            {job?.status === "completed"
              ? "Play it back. Save the moment. Explore what comes next."
              : "Your project persists when you leave this page. The worker continues in the background."}
          </p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {job ? (
        <div className="result-layout polished-result">
          <div>
            {job.status === "completed" && job.outputId ? (
              <>
                <video
                  className="result-player"
                  controls
                  playsInline
                  preload="metadata"
                  src={`/api/assets/${job.outputId}`}
                  aria-label="Fixed demo sample, not generated from your uploads"
                />
                <div className="result-meta">
                  <span>Fixed 10-second demo sample · 720p</span>
                  <span>{money(job.price)} simulated</span>
                </div>
                <p className="notice">
                  <strong>Demo sample, not an AI generation.</strong> This
                  included video does not use your music or artist image. Your
                  selected audio was really trimmed and validated; the sample
                  length remains 10 seconds.
                </p>
                <div className="result-actions" style={{ marginTop: 20 }}>
                  <a
                    href={`/api/assets/${job.outputId}?download=1`}
                    download
                    className="button primary"
                  >
                    <Download size={16} /> Download demo
                  </a>
                  <button
                    className="button outline"
                    disabled={saving || job.saved}
                    onClick={() => void action({ saved: true })}
                  >
                    <Bookmark size={16} />
                    {job.saved ? "Saved to projects" : "Save to projects"}
                  </button>
                </div>
              </>
            ) : ["failed", "cancelled"].includes(job.status) ? (
              <div className="content-card">
                <h2>
                  {job.status === "failed"
                    ? "Generation failed"
                    : "Cancelled before processing"}
                </h2>
                <p>
                  {job.error ||
                    "Your demo credit reservation has been restored."}
                </p>
                <Link href="/studio" className="button primary">
                  Return to studio <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <div className="progress-card" aria-live="polite">
                <Mark />
                <h2>
                  {job.status === "queued"
                    ? "Your demo is queued"
                    : "Preparing your demo"}
                </h2>
                <p>{job.stage}</p>
                <progress aria-label="Generation in progress" />
                <div className="progress-stages">
                  <p>
                    <Check size={17} /> Uploads validated
                  </p>
                  <p>
                    <Circle size={17} /> Trimming the selected audio
                  </p>
                  <p>
                    <Circle size={17} /> Preparing the fixed demo sample
                  </p>
                </div>
                <small className="quiet">
                  You can close this page and return to My Projects.
                </small>
                {job.status === "queued" && (
                  <div>
                    <button
                      disabled={saving}
                      className="text-button"
                      onClick={() => void action({ cancel: true })}
                    >
                      Cancel queued generation
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="content-card">
            <span className="demo-badge">Demo project</span>
            <h2 style={{ marginTop: 16 }}>{job.artistName}</h2>
            <dl className="detail-list">
              <dt>Requested duration</dt>
              <dd>{(job.end - job.start).toFixed(2)} seconds</dd>
              <dt>Audio selection</dt>
              <dd>
                {job.start.toFixed(2)} – {job.end.toFixed(2)}s
              </dd>
              <dt>Performance</dt>
              <dd>{job.performance}</dd>
              <dt>Camera</dt>
              <dd>{job.camera}</dd>
              <dt>Customer total</dt>
              <dd>{money(job.price)} (demo)</dd>
              <dt>Status</dt>
              <dd>{job.status}</dd>
            </dl>
            <h3>Composed prompt</h3>
            <p style={{ marginTop: 10, fontSize: 12 }}>{job.prompt}</p>
            <p className="quiet" style={{ marginTop: 16 }}>
              Custom prompts replace preset guidance. Live output quality and
              movement are not guaranteed.
            </p>
            <Link href="/studio" className="button outline">
              Create another video <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      ) : (
        !error && <p className="quiet">Loading your private project…</p>
      )}
    </div>
  );
}
