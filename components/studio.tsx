"use client";
import dynamic from "next/dynamic";
import { StudioLiveControl } from "./studio-live";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Clock,
  ImagePlus,
  Music2,
  X,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { api, ensureSession, upload } from "@/lib/client";
import { parseStudioDraft } from "@/lib/studio-draft";
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
    [sessionOwner, setSessionOwner] = useState(""),
    [showArtists, setShowArtists] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [price, setPrice] = useState<number | null>(null),
    [consentKey, setConsentKey] = useState<string | null>(null),
    [termsVersion, setTermsVersion] = useState(""),
    [advanced, setAdvanced] = useState(false);
  const router = useRouter(),
    fileInput = useRef<HTMLInputElement>(null),
    requestKey = useRef<string | null>(null),
    declinedRights = useRef<string | null>(null),
    dialog = useRef<HTMLDialogElement>(null),
    artistTrigger = useRef<HTMLButtonElement>(null);
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
  const selection =
    song && sessionOwner && imageId
      ? {
          version: 1 as const,
          owner: sessionOwner,
          songId: song.id,
          imageId,
          start,
          end,
          performance,
          camera,
          customPrompt,
        }
      : null;
  const rightsKey = JSON.stringify([selection, termsVersion]);
  const consent = consentKey === rightsKey;
  useEffect(() => {
    let current = true;
    const [selected, version] = JSON.parse(rightsKey);
    const timer = setTimeout(() => {
      if (selected && version) {
        void api<{ confirmed: boolean }>("studio-live", {
          method: "POST",
          body: JSON.stringify({
            action: "rights-status",
            selection: selected,
          }),
        })
          .then((r) => {
            if (current && r.confirmed && declinedRights.current !== rightsKey)
              setConsentKey(rightsKey);
          })
          .catch(() => {});
      }
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [rightsKey]);
  function update(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    requestKey.current = null;
  }
  useEffect(() => {
    void api<{ version: string }>("rights")
      .then((r) => setTermsVersion(r.version))
      .catch(() => setTermsVersion(""));
  }, []);
  useEffect(() => {
    ensureSession()
      .then((session) => {
        setSessionOwner((session as { owner: string }).owner);
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
    else if (dialog.current?.open) {
      dialog.current.close();
      artistTrigger.current?.focus();
    }
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
  function exportDraft() {
    if (!song) return;
    try {
      const exported = parseStudioDraft({
        version: 1,
        owner: sessionOwner,
        songId: song.id,
        imageId,
        start,
        end,
        performance,
        camera,
        customPrompt,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "singmotion-draft.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
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
          termsVersion,
        }),
      });
      window.dispatchEvent(new Event("credits-changed"));
      router.push(`/projects/${j.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="studio-page continuous-studio" id="content">
      <h1 className="sr-only">Create your music video</h1>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="studio-grid">
        <div className="editor">
          <section id="studio-step-1" className="editor-section">
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
                  type="button"
                  className="icon-button remove-song"
                  aria-label="Remove song from draft"
                  disabled={uploading}
                  onClick={() => {
                    update({ song: null, start: 0, end: 10 });
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  <X size={18} />
                </button>
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
              <span className="micro-label">
                {song
                  ? `${Math.max(0, end - start).toFixed(2)}s selected`
                  : "Find your best moment"}
              </span>
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
                        // Whole-pixel strings serialize identically in SSR and the browser.
                        height: `${Math.round(
                          5 +
                            Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.2)) *
                              29,
                        )}px`,
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
          <section id="studio-step-2" className="editor-section">
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
                  ref={artistTrigger}
                  onClick={() => setShowArtists(true)}
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                className="choose-artist"
                disabled={!ready}
                ref={artistTrigger}
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
          <section id="studio-step-3" className="editor-section">
            <div className="step-title">
              <span className="step-number">3</span>
              <h2>Performance &amp; camera</h2>
            </div>
            <p className="direction-defaults">
              {customPrompt.trim()
                ? "Custom performance direction"
                : `${performance} performance · ${camera}`}
            </p>
            <button
              className="advanced-toggle"
              onClick={() => setAdvanced(!advanced)}
              aria-expanded={advanced}
              aria-controls="studio-advanced"
            >
              <SlidersHorizontal size={16} /> Advanced settings{" "}
              <ChevronDown size={15} />
            </button>
            <div
              id="studio-advanced"
              className="custom-prompt"
              hidden={!advanced}
            >
              <fieldset className="performance-presets">
                <legend>Performance</legend>
                {performances.map((p) => (
                  <label
                    key={p}
                    className={performance === p ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="performance"
                      value={p}
                      checked={performance === p}
                      onChange={() => {
                        update({ performance: p });
                        if (p === "Custom") setAdvanced(true);
                      }}
                    />
                    {p}
                  </label>
                ))}
              </fieldset>
              <label className="camera-field">
                Camera direction
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
              <details className="prompt-preview">
                <summary>
                  View composed prompt <ChevronDown size={14} />
                </summary>
                <p>{prompt || "Add a custom prompt to continue."}</p>
              </details>
            </div>
          </section>
        </div>
        <div className="preview-column mobile-review">
          <div className="generation-summary">
            <div className="summary-heading">
              <span className="eyebrow">YOUR SELECTION</span>
              <span className="demo-badge">Demo</span>
            </div>
            <div className="summary-main">
              <div>
                <Clock size={18} />
                <span>
                  <strong>
                    {(end - start).toFixed(2).replace(/\.00$/, "")} seconds
                  </strong>
                  <small>Requested audio excerpt · MP4 demo</small>
                </span>
              </div>
              <strong className="total-price">
                {price === null ? "—" : money(price)}
              </strong>
            </div>
            <p className="summary-cost-note">
              Simulated credits only. No charge.
            </p>
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
                required
                disabled={!termsVersion}
                onChange={(e) => {
                  declinedRights.current = e.target.checked ? null : rightsKey;
                  setConsentKey(e.target.checked ? rightsKey : null);
                }}
              />
              <span>
                I own or have all necessary permissions for the music, sound
                recording, image and likeness, including AI processing described
                in the{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer">
                  AGB / Terms
                </a>
                .
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
            <button
              className="text-button export-draft"
              type="button"
              disabled={
                !ready ||
                !sessionOwner ||
                uploading ||
                !song ||
                !imageId ||
                !validSegment ||
                !prompt
              }
              onClick={exportDraft}
            >
              Export draft for offline review
            </button>
            <StudioLiveControl
              selection={selection}
              artistName={artistName}
              consent={consent}
              termsVersion={termsVersion}
              disabled={
                busy || uploading || !validSegment || end - start < 4 || !prompt
              }
              disabledReason={
                busy
                  ? "Another Studio operation is running. Wait for it to finish."
                  : uploading
                    ? "The media upload is still running. Wait for it to finish."
                    : !validSegment
                      ? "Select a valid excerpt within the uploaded song."
                      : end - start < 4
                        ? "The private pilot requires at least 4 seconds of audio."
                        : !prompt
                          ? "Choose valid performance/camera settings and a valid prompt."
                          : undefined
              }
            />
            <p className="demo-disclaimer">
              <ShieldCheck size={13} /> Simulated render. A fixed sample, not a
              video of your uploads.
            </p>
          </div>
        </div>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setShowArtists(false)}
        onClose={() => setShowArtists(false)}
        className="artist-dialog"
        aria-label="Choose your artist"
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
