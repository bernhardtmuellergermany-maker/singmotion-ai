"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  AudioLines,
  Check,
  ChevronDown,
  Clock,
  ImagePlus,
  Lightbulb,
  Music2,
  Upload,
  X,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { api, ensureSession, upload } from "@/lib/client";
import {
  money,
  time,
  performances,
  cameras,
  composePrompt,
  validateSelection,
  validateFile,
  type Asset,
  type Job,
} from "@/lib/domain";
import { ArtistLibrary } from "./artists";
const Waveform = dynamic(() => import("./waveform"), {
  ssr: false,
  loading: () => <div className="wave-loading">Preparing your waveform…</div>,
});
interface Draft {
  song: Asset | null;
  imageId: string;
  artistName: string;
  start: number;
  end: number;
  performance: string;
  camera: string;
  customPrompt: string;
}
const initial: Draft = {
  song: null,
  imageId: "",
  artistName: "",
  start: 0,
  end: 10,
  performance: "Natural",
  camera: "Static Close-Up",
  customPrompt: "",
};
export function Studio() {
  const [draft, setDraft] = useState<Draft>(initial),
    [ready, setReady] = useState(false),
    [step, setStep] = useState(1),
    [showArtists, setShowArtists] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [price, setPrice] = useState<number | null>(null),
    [consent, setConsent] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const router = useRouter(),
    fileInput = useRef<HTMLInputElement>(null),
    requestKey = useRef<string | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const {
    song,
    imageId,
    artistName,
    start,
    end,
    performance,
    camera,
    customPrompt,
  } = draft;
  function update(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    requestKey.current = null;
  }
  useEffect(() => {
    ensureSession()
      .then(() => {
        try {
          const saved = localStorage.getItem("singmotion-studio");
          if (saved) setDraft({ ...initial, ...JSON.parse(saved) });
        } catch {}
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("singmotion-studio", JSON.stringify(draft));
  }, [draft, ready]);
  useEffect(() => {
    let current = true;
    api<{ cents: number }>("quote", {
      method: "POST",
      body: JSON.stringify({ duration: end - start }),
    })
      .then((q) => {
        if (current) setPrice(q.cents);
      })
      .catch(() => {
        if (current) setPrice(null);
      });
    return () => {
      current = false;
    };
  }, [start, end, ready]);
  useEffect(() => {
    if (showArtists) dialog.current?.showModal();
    else dialog.current?.close();
  }, [showArtists]);
  let prompt = "";
  try {
    prompt = composePrompt(performance, camera, customPrompt);
  } catch {}
  let validSegment = false;
  try {
    if (song) {
      validateSelection(start, end, song.duration || 0);
      validSegment = true;
    }
  } catch {}
  async function selectFile(file?: File) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      validateFile(file.name, file.size, "audio");
      const a = await upload(file, "audio");
      update({ song: a, start: 0, end: Math.min(10, a.duration || 10) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function generate() {
    if (!song || price === null) return;
    setBusy(true);
    setError("");
    requestKey.current ??= crypto.randomUUID();
    try {
      const j = await api<Job>("jobs", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          songId: song.id,
          expectedPrice: price,
          requestKey: requestKey.current,
          consent,
        }),
      });
      window.dispatchEvent(new Event("credits-changed"));
      router.push(`/projects/${j.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const canNext =
    step === 1 ? !!song && validSegment : step === 2 ? !!imageId : true;
  return (
    <div className="studio-page" id="content">
      <div className="page-heading studio-heading">
        <div>
          <span className="eyebrow">THE STUDIO</span>
          <h1>
            Create your
            <br className="desktop-break" /> singing video
            <span className="heading-dot">.</span>
          </h1>
          <p>Your song. A familiar face. A whole new way to be heard.</p>
        </div>
        <span className="studio-version">WORKSPACE / 01</span>
      </div>
      <div className="mobile-steps" aria-label={`Step ${step} of 3`}>
        {["Your song", "Your artist", "Your direction"].map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i + 1)}
            className={step === i + 1 ? "current" : step > i + 1 ? "done" : ""}
          >
            <span>{step > i + 1 ? <Check size={12} /> : i + 1}</span>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="studio-grid">
        <div className="editor">
          <section
            className={`editor-section mobile-step ${step === 1 ? "visible" : ""}`}
          >
            <div className="step-title">
              <span className="step-number">1</span>
              <h2>Upload your song</h2>
              {song && <Check className="done-check" size={19} />}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              className="sr-only"
              aria-label="Upload song"
              onChange={(e) => void selectFile(e.target.files?.[0])}
            />
            {song ? (
              <div className="file-card">
                <div className="file-icon">
                  <AudioLines size={30} />
                </div>
                <div className="truncate">
                  <strong>{song.name}</strong>
                  <span>
                    {time(song.duration || 0)} ·{" "}
                    {song.name.toLowerCase().endsWith(".wav") ? "WAV" : "MP3"} ·{" "}
                    {(song.bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
                <button
                  className="button outline small"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                className="upload-zone"
                disabled={uploading || !ready}
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!uploading && ready)
                    void selectFile(e.dataTransfer.files[0]);
                }}
              >
                <div className="upload-icon">
                  <Music2 size={26} />
                </div>
                <strong>
                  {uploading
                    ? "Uploading & checking your song…"
                    : "Drop your song here"}
                </strong>
                <span>
                  or <u>browse files</u> to find your sound
                </span>
                <small>MP3 or WAV · up to 50 MB</small>
              </button>
            )}
            {uploading && song && (
              <p role="status">Uploading & checking audio…</p>
            )}
            <div className="section-subtitle">
              <span>Select your audio section</span>
              <span className="micro-label">START SMALL. DREAM BIG.</span>
            </div>
            {song ? (
              <Waveform
                key={song.id}
                url={`/api/assets/${song.id}`}
                duration={song.duration || 1}
                start={start}
                end={end}
                onChange={(s, e) => update({ start: s, end: e })}
              />
            ) : (
              <div className="empty-wave">
                <div aria-hidden="true">
                  {Array.from({ length: 66 }, (_, i) => (
                    <i
                      key={i}
                      style={{
                        height:
                          5 +
                          Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.2)) * 29,
                      }}
                    />
                  ))}
                </div>
                <span>Your waveform will appear here</span>
              </div>
            )}
            {song && !validSegment && (
              <p className="error">
                Choose valid start and end times within the song (up to 300
                seconds).
              </p>
            )}
          </section>
          <section
            className={`editor-section mobile-step ${step === 2 ? "visible" : ""}`}
          >
            <div className="step-title">
              <span className="step-number">2</span>
              <h2>Choose your artist</h2>
              {imageId && <Check className="done-check" size={19} />}
            </div>
            {imageId ? (
              <div className="file-card artist-selection">
                <img src={`/api/assets/${imageId}`} alt={artistName} />
                <div>
                  <strong>{artistName}</strong>
                  <span>One primary reference</span>
                </div>
                <button
                  className="button outline small"
                  onClick={() => setShowArtists(true)}
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                className="choose-artist"
                disabled={!ready}
                onClick={() => setShowArtists(true)}
              >
                <div className="artist-placeholder">
                  <ImagePlus size={24} />
                </div>
                <span>
                  <strong>Who’s taking the stage?</strong>
                  <small>Upload a reference or choose a saved artist</small>
                </span>
                <span className="round-plus">+</span>
              </button>
            )}
            <p className="field-note">
              Your artist, your image. A clear, front-facing portrait works
              best.
            </p>
          </section>
          <section
            className={`editor-section mobile-step ${step === 3 ? "visible" : ""}`}
          >
            <div className="step-title">
              <span className="step-number">3</span>
              <h2>Performance & camera</h2>
            </div>
            <div className="select-row">
              <label>
                Performance
                <div className="select-wrap">
                  <select
                    value={performance}
                    onChange={(e) => update({ performance: e.target.value })}
                  >
                    {performances.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </label>
              <label>
                Camera
                <div className="select-wrap">
                  <select
                    value={camera}
                    onChange={(e) => update({ camera: e.target.value })}
                  >
                    {cameras.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </label>
            </div>
            <p className="field-note">
              Creative guidance, not guaranteed controls. Static and gentle
              movements are safer starting points.
            </p>
            <button
              className="advanced-toggle"
              onClick={() => setAdvanced(!advanced)}
              aria-expanded={advanced}
            >
              <SlidersHorizontal size={16} /> Advanced settings{" "}
              <ChevronDown size={15} />
            </button>
            <div className={`custom-prompt ${advanced ? "expanded" : ""}`}>
              <label htmlFor="custom-prompt">
                Custom Performance Prompt <span>Optional</span>
              </label>
              <textarea
                id="custom-prompt"
                maxLength={1500}
                rows={3}
                value={customPrompt}
                onChange={(e) => update({ customPrompt: e.target.value })}
                placeholder="Describe how your artist should perform, move, and express the song..."
              />
              <small className="quiet">
                Write in English. No additional prompt fee.
              </small>
              {customPrompt.trim() && (
                <p className="notice">
                  Your custom prompt replaces both preset directions in full.
                  Include any performance and camera instructions you want to
                  keep.
                </p>
              )}
            </div>
            <details className="prompt-preview">
              <summary>
                View composed prompt <ChevronDown size={14} />
              </summary>
              <p>{prompt || "Add a custom prompt to continue."}</p>
            </details>
          </section>
        </div>
        <div className={`preview-column ${step === 3 ? "mobile-review" : ""}`}>
          <div className="preview-frame">
            {imageId ? (
              <img
                className="reference-preview"
                src={`/api/assets/${imageId}`}
                alt={`${artistName} — selected reference, not a generated video`}
              />
            ) : (
              <div className="preview-empty">
                <div className="preview-halo" />
                <div className="preview-portrait">
                  <ImagePlus size={37} strokeWidth={1} />
                </div>
                <h3>
                  A new stage.
                  <br />
                  For your sound.
                </h3>
                <p>Your artist preview will appear here.</p>
                <button
                  className="button frosted"
                  disabled={!ready}
                  onClick={() => setShowArtists(true)}
                >
                  <Upload size={15} /> Add your artist
                </button>
              </div>
            )}
            <div className="preview-top">
              <span>
                <span className="status-dot" />
                {imageId ? "ARTIST REFERENCE" : "YOUR PERFORMANCE"}
              </span>
              <span>720p</span>
            </div>
            <div className="preview-caption">
              <span>
                <span className="outline-play">▷</span>
                {imageId
                  ? "Reference image preview"
                  : "The next chapter of your music"}
              </span>
              <span>{imageId ? "Not a generated video" : "Made by you."}</span>
            </div>
          </div>
          <details className="tips-card" open>
            <summary>
              <Lightbulb size={23} />
              <strong>Small details. Better performances.</strong>
              <ChevronDown size={16} />
            </summary>
            <p>
              Use a sharp image with an unobstructed face and clear lead vocals.
              Start with 5–10 seconds and a static camera.
            </p>
            <p className="extra-tip">
              Strong head rotations may alter facial details. Dynamic cameras
              can reduce background consistency. Directions and identity are
              never guaranteed.
            </p>
          </details>
          <div className="generation-summary">
            <div className="summary-heading">
              <span className="eyebrow">YOUR NEXT PERFORMANCE</span>
              <span className="demo-badge">Demo</span>
            </div>
            <div className="summary-main">
              <div>
                <Clock size={18} />
                <span>
                  <strong>
                    {(end - start).toFixed(2).replace(/\.00$/, "")} seconds
                  </strong>
                  <small>720p · 25 FPS · MP4</small>
                </span>
              </div>
              <strong className="total-price">
                {price === null ? "—" : money(price)}
              </strong>
            </div>
            <details className="why-price">
              <summary>Why this price?</summary>
              <p>
                Illustrative customer total based on the selected duration,
                including German VAT when applicable. Custom prompts cost
                nothing extra. This is not the provider’s cost. No provider
                billing minimum is assumed. No real money is charged.
              </p>
            </details>
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I have the rights or permission to use this music and person’s
                likeness.
              </span>
            </label>
            <button
              className="button primary generate-button"
              disabled={
                busy ||
                uploading ||
                !song ||
                !validSegment ||
                !imageId ||
                !consent ||
                !prompt ||
                price === null
              }
              onClick={() => void generate()}
            >
              {busy ? "Preparing your project…" : "Generate demo video"}
              <ArrowRight size={19} />
            </button>
            <p className="demo-disclaimer">
              <ShieldCheck size={13} /> Simulated render. A fixed sample, not a
              video of your uploads.
            </p>
          </div>
        </div>
      </div>
      <div className="mobile-step-actions">
        {step > 1 && (
          <button className="button outline" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={16} /> Back
          </button>
        )}
        {step < 3 && (
          <button
            className="button primary"
            disabled={!canNext}
            onClick={() => setStep(step + 1)}
          >
            Continue <ArrowRight size={16} />
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setShowArtists(false)}
        onClose={() => setShowArtists(false)}
        className="artist-dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">THE CAST</span>
            <h2>Choose your artist</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close artist library"
            onClick={() => setShowArtists(false)}
          >
            <X size={22} />
          </button>
        </div>
        {showArtists && (
          <ArtistLibrary
            selected={imageId}
            onSelect={(a, id) => {
              update({ imageId: id, artistName: a.name });
              setShowArtists(false);
            }}
          />
        )}
      </dialog>
    </div>
  );
}
