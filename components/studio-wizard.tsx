"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Music2,
  ImagePlus,
  Smartphone,
  Monitor,
  Sparkles,
  X,
} from "lucide-react";
import { ProductHeader } from "./product-header";
import { GenerationDialog } from "./generation-dialog";
import { api, ensureSession, upload } from "@/lib/client";
import {
  composePrompt,
  validateSelection,
  validateFile,
  performances,
  cameras,
  time,
  type Asset,
} from "@/lib/domain";
import { photoFormat } from "@/lib/studio-editor";
import { defaultStudioContent, type StudioContent } from "@/lib/studio-content";
import { productCopy } from "@/lib/product-copy";
import type { StudioDraftExport } from "@/lib/studio-draft";
const Waveform = dynamic(() => import("./waveform"), {
  ssr: false,
  loading: () => <p role="status">Preparing waveform…</p>,
});
const steps = productCopy.en.steps;
const initial = {
  song: null as Asset | null,
  imageId: "",
  artistName: "My artist",
  start: 0,
  end: 10,
  performance: "Natural",
  camera: "Static Close-Up",
  customPrompt: "",
  outputFormat: "9:16" as "9:16" | "16:9",
  formatMode: "auto" as "auto" | "9:16" | "16:9",
};
export function StudioWizard({
  content = defaultStudioContent,
}: {
  content?: StudioContent;
}) {
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const draftId = useRef<string>(""),
    [saved, setSaved] = useState(false),
    [projectKey, setProjectKey] = useState("");
  const [draft, setDraft] = useState(initial),
    [step, setStep] = useState(0),
    [owner, setOwner] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [detectedFormat, setDetectedFormat] = useState<"9:16" | "16:9">("9:16");
  useEffect(() => {
    let current = true;
    void ensureSession()
      .then(async (session) => {
        if (!current) return;
        setOwner((session as { owner: string }).owner);
        const requested = new URLSearchParams(window.location.search).get(
          "draft",
        );
        draftId.current =
          requested ||
          localStorage.getItem("singmotion-draft-id") ||
          crypto.randomUUID();
        localStorage.setItem("singmotion-draft-id", draftId.current);
        setProjectKey(draftId.current);
        if (requested) {
          const saved = await api<{
            selection: StudioDraftExport;
            song: Asset | null;
            image: Asset | null;
            artistName: string;
            step: number;
          }>(`studio-drafts/${encodeURIComponent(requested)}`);
          if (!current) return;
          setDraft({
            ...initial,
            ...saved.selection,
            song: saved.song,
            artistName: saved.artistName,
          });
          // Drafts already saved by the four-step wizard use 0–3 unchanged.
          // Earlier five-step drafts used 3 for performance and 4 for review.
          setStep(Math.max(0, Math.min(3, saved.step)));
          setDetectedFormat(
            photoFormat(
              saved.image?.width ?? null,
              saved.image?.height ?? null,
            ),
          );
          setReady(true);
          return;
        }
        try {
          const saved = localStorage.getItem("singmotion-studio");
          if (saved) {
            const restored = { ...initial, ...JSON.parse(saved) };
            setDraft(restored);
            if (restored.imageId) {
              const img = new Image();
              img.onload = () => {
                if (current)
                  setDetectedFormat(
                    photoFormat(img.naturalWidth, img.naturalHeight),
                  );
              };
              img.src = `/api/assets/${encodeURIComponent(restored.imageId)}`;
            }
          }
        } catch {}
        setReady(true);
      })
      .catch(() =>
        setError("Could not open your private workspace. Reload to retry."),
      );
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("singmotion-studio", JSON.stringify(draft));
  }, [draft, ready]);
  useEffect(() => {
    if (!ready || !owner || !projectKey) return;
    let current = true;
    const id = projectKey;
    const timer = setTimeout(() => {
      const selection: StudioDraftExport = {
        version: 1,
        owner,
        songId: draft.song?.id || "",
        imageId: draft.imageId,
        start: draft.start,
        end: draft.end,
        performance: draft.performance,
        camera: draft.camera,
        customPrompt: draft.customPrompt,
        outputFormat: draft.outputFormat,
        formatMode: draft.formatMode,
      };
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() =>
          api("studio-drafts", {
            method: "POST",
            body: JSON.stringify({
              id,
              selection,
              artistName: draft.artistName,
              step,
            }),
          }),
        )
        .then(() => {
          if (current) setSaved(true);
        })
        .catch(() => {
          if (current)
            setError(
              "Draft could not be saved on the server. Your browser draft is retained; retry before leaving.",
            );
        });
    }, 700);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [draft, step, owner, ready, projectKey]);
  function update(patch: Partial<typeof initial>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError("");
    setSaved(false);
  }
  async function add(file: File | undefined, kind: "audio" | "image") {
    if (!file || busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      validateFile(file.name, file.size, kind);
      const asset = await upload(file, kind);
      if (kind === "audio")
        update({
          song: asset,
          start: 0,
          end: Math.min(10, asset.duration || 10),
        });
      else {
        const detected = photoFormat(asset.width, asset.height);
        setDetectedFormat(detected);
        update({
          imageId: asset.id,
          artistName: file.name.replace(/\.[^.]+$/, ""),
          ...(draft.formatMode === "auto" ? { outputFormat: detected } : {}),
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  let audioValid = false,
    prompt = "";
  try {
    if (draft.song) {
      validateSelection(draft.start, draft.end, draft.song.duration || 0);
      audioValid = true;
    }
    prompt = composePrompt(draft.performance, draft.camera, draft.customPrompt);
  } catch {}
  const selection: StudioDraftExport | null =
    draft.song && draft.imageId && owner
      ? {
          version: 1,
          owner,
          songId: draft.song.id,
          imageId: draft.imageId,
          start: draft.start,
          end: draft.end,
          performance: draft.performance,
          camera: draft.camera,
          customPrompt: draft.customPrompt,
          outputFormat: draft.outputFormat,
          formatMode: draft.formatMode,
        }
      : null;
  const canAdvance =
    ready &&
    !busy &&
    (step === 0
      ? audioValid
      : step === 1
        ? !!draft.imageId
        : step === 2
          ? !!prompt
          : true);
  const allowed = (index: number) =>
    index === 0 || (audioValid && (index === 1 || !!draft.imageId));
  return (
    <div className="product-theme product-studio">
      <ProductHeader />
      <main id="content" className="wizard-layout">
        <nav className="wizard-steps" aria-label="Creation steps">
          {steps.map((name, index) => (
            <button
              key={name}
              aria-current={step === index ? "step" : undefined}
              disabled={!allowed(index) || busy}
              onClick={() => setStep(index)}
            >
              <span>{index + 1}</span>
              <b>{name}</b>
            </button>
          ))}
        </nav>
        <div className="wizard-card">
          <p className="wizard-kicker">STEP {step + 1}/4</p>
          {step === 0 && (
            <>
              <h1>Add your song</h1>
              <p>{content.intro}</p>
              <label
                className="wizard-upload compact-upload"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void add(e.dataTransfer.files[0], "audio");
                }}
              >
                <Music2 />
                <strong>
                  {busy ? "Checking your audio…" : "Upload audio"}
                </strong>
                <span>MP3, WAV, M4A · up to 50 MB</span>
                <input
                  aria-label="Choose audio file"
                  type="file"
                  accept=".mp3,.wav,.m4a"
                  disabled={!ready || busy}
                  onChange={(e) => void add(e.target.files?.[0], "audio")}
                />
              </label>
              {draft.song && (
                <>
                  <div className="wizard-file">
                    <Music2 />
                    <div>
                      <strong>{draft.song.name}</strong>
                      <small>
                        {time(draft.song.duration || 0)} ·{" "}
                        {(draft.song.bytes / 1048576).toFixed(1)} MB
                      </small>
                    </div>
                    <button
                      aria-label="Remove song"
                      disabled={busy}
                      onClick={() => update({ song: null })}
                    >
                      <X />
                    </button>
                  </div>
                  <h2>Select the section</h2>
                  <Waveform
                    key={draft.song.id}
                    url={`/api/assets/${draft.song.id}`}
                    duration={draft.song.duration || 1}
                    start={draft.start}
                    end={draft.end}
                    onChange={(start, end) => update({ start, end })}
                  />
                  <p>
                    {(draft.end - draft.start).toFixed(3)} seconds selected. The
                    server checks the supported generation duration before
                    submission.
                  </p>
                </>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <h1>Choose your photo</h1>
              <p>
                Upload a clear, front-facing portrait you have permission to
                use.
              </p>
              <label className="wizard-upload photo-upload compact-upload">
                <ImagePlus />
                <strong>Upload photo</strong>
                <span>JPG or PNG · up to 30 MB · server-validated</span>
                <input
                  aria-label="Choose photo file"
                  type="file"
                  accept=".jpg,.jpeg,.png"
                  disabled={busy}
                  onChange={(e) => void add(e.target.files?.[0], "image")}
                />
              </label>
              {draft.imageId && (
                <button
                  className="product-secondary"
                  disabled={busy}
                  onClick={() => update({ imageId: "" })}
                >
                  Remove photo
                </button>
              )}
              <div
                className="format-options"
                role="group"
                aria-label="Video orientation"
                style={{ marginTop: 16 }}
              >
                {(["auto", "9:16", "16:9"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    disabled={busy}
                    aria-pressed={draft.formatMode === format}
                    onClick={() => {
                      update({
                        formatMode: format,
                        outputFormat:
                          format === "auto" ? detectedFormat : format,
                      });
                    }}
                  >
                    {format === "16:9" ? <Monitor /> : <Smartphone />}
                    <strong>{format === "auto" ? "Auto" : format}</strong>
                    <span>
                      {format === "auto"
                        ? "From photo"
                        : format === "9:16"
                          ? "Vertical"
                          : "Horizontal"}
                    </span>
                  </button>
                ))}
              </div>
              <p className="field-note">
                Output: {draft.outputFormat}. Square and near-square photos
                default to 9:16. Landscape export may use padding; native
                landscape generation is not guaranteed.
              </p>
              <p>
                <Link href="/artists">Manage your saved artists</Link>
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <h1>Performance &amp; camera</h1>
              <p>
                Describe the performance. Use suggestions as a starting point.
              </p>
              <label htmlFor="performance-prompt">Your direction</label>
              <textarea
                id="performance-prompt"
                maxLength={1000}
                rows={4}
                value={draft.customPrompt}
                onChange={(e) => update({ customPrompt: e.target.value })}
                placeholder="E.g. Singer walks forward, looking into camera…"
              />
              <div className="suggestion-chips">
                {[
                  ...content.performanceTemplates,
                  ...content.cameraTemplates,
                ].map(({ label, prompt: text }) => (
                  <button
                    key={label}
                    onClick={() =>
                      update({
                        customPrompt: [draft.customPrompt.trim(), text]
                          .filter(Boolean)
                          .join(". ")
                          .slice(0, 1000),
                        performance: "Custom",
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="wizard-fields">
                <label>
                  Performance
                  <select
                    value={draft.performance}
                    onChange={(e) => update({ performance: e.target.value })}
                  >
                    {performances.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Camera
                  <select
                    value={draft.camera}
                    onChange={(e) => update({ camera: e.target.value })}
                  >
                    {cameras.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="field-note">
                A custom direction replaces the preset text. Include any camera
                instructions you want to keep. Camera movements are suggestions,
                not guaranteed results.
              </p>
              <details>
                <summary>English prompt preview</summary>
                <p>{prompt || "Enter a valid direction."}</p>
              </details>
            </>
          )}
          {step === 3 && (
            <>
              <h1>Generate your performance</h1>
              <p>
                Review your selection. You will confirm rights and the
                server-reviewed cost before generating.
              </p>
              <div className="wizard-review">
                {[
                  {
                    label: "Audio",
                    value: `${draft.song?.name || "No song"} · ${draft.start.toFixed(3)}–${draft.end.toFixed(3)}s`,
                    at: 0,
                  },
                  { label: "Photo", value: draft.artistName, at: 1 },
                  {
                    label: "Format",
                    value: `${draft.outputFormat} · fitted export`,
                    at: 1,
                  },
                  { label: "Performance", value: prompt, at: 2 },
                ].map((row) => (
                  <button key={row.label} onClick={() => setStep(row.at)}>
                    <strong>{row.label}</strong>
                    <span>{row.value}</span>
                    <span>Edit</span>
                  </button>
                ))}
              </div>
              <p>
                {(draft.end - draft.start).toFixed(3)}s selected audio. Final
                video duration is checked against the reviewed generation
                policy.
              </p>
              <p>
                No customer payment is active. Operators can review their
                authorized generation cost.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="product-actions">
            {step > 0 && <button
              className="product-secondary"
              disabled={step === 0 || busy}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} /> Back
            </button>}
            {step < 3 ? (
              <button
                className="product-primary"
                disabled={!canAdvance}
                onClick={() => setStep(step + 1)}
              >
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="product-primary"
                disabled={!selection || !audioValid || !prompt || busy}
                onClick={() => setConfirm(true)}
              >
                <Sparkles size={17} /> Generate performance
              </button>
            )}
          </div>
        </div>
      </main>
      <footer className="wizard-footer">
        <span role="status">{saved ? "Draft saved" : "Browser draft"}</span>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/help">Help</Link>
        <Link href="/legal">Legal notice</Link>
      </footer>
      {confirm && selection && (
        <GenerationDialog
          key={JSON.stringify(selection)}
          selection={selection}
          requestKey={projectKey}
          artistName={draft.artistName}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
