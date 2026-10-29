"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GlobalMenu } from "./home-collection";
import {
  ArrowLeft,
  ArrowRight,
  Music2,
  ImagePlus,
  Smartphone,
  Monitor,
  Sparkles,
  X,
  House,
  MoreVertical,
  UserRound,
  Camera,
  Play,
  Trash2,
  FileMusic,
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
  camera: "Static camera",
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
  const [projectName, setProjectName] = useState(""),
    [editingName, setEditingName] = useState(false),
    [draft, setDraft] = useState(initial),
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
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("draft");
        const createNew = params.get("new") === "1" && !requested;
        draftId.current =
          requested ||
          (createNew ? null : localStorage.getItem("singmotion-draft-id")) ||
          crypto.randomUUID();
        localStorage.setItem("singmotion-draft-id", draftId.current);
        setProjectKey(draftId.current);
        setProjectName(localStorage.getItem(`singmotion-project-name:${draftId.current}`) || new Date().toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }));
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
        if (createNew) {
          let fresh = { ...initial };
          if (params.get("audio") === "1") {
            try {
              const stored = sessionStorage.getItem("singmotion-home-audio-handoff");
              sessionStorage.removeItem("singmotion-home-audio-handoff");
              if (stored) {
                const song = JSON.parse(stored) as Asset;
                if (song && song.kind === "audio" && typeof song.id === "string" && song.id) {
                  fresh = { ...initial, song, start: 0, end: Math.min(10, song.duration || 10) };
                }
              }
            } catch { /* A broken handoff must never restore an old project. */ }
          }
          setDraft(fresh);
          setStep(0);
          setDetectedFormat("9:16");
          localStorage.setItem("singmotion-studio", JSON.stringify(fresh));
          window.history.replaceState(window.history.state, "", "/studio");
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

  const available = !!selection && audioValid && !!prompt && !busy;
  const cameraOptions: readonly string[] = cameras;
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>(".singmotion-flow details.flow-menu, .singmotion-flow details.flow-camera-menu").forEach(menu => {
        if (!menu.contains(event.target as Node)) menu.open = false;
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") document.querySelectorAll<HTMLDetailsElement>(".singmotion-flow details[open]").forEach(menu => menu.open = false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, []);
  const rename = (name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      setProjectName(trimmed);
      localStorage.setItem(`singmotion-project-name:${projectKey}`, trimmed);
    }
    setEditingName(false);
  };
  return (
    <div className="product-theme singmotion-flow">
      <header className="flow-header">
        <div className="flow-header-left">
          <Link href="/" aria-label="SingMotion AI home" className="sm-wordmark">SingMotion <span>AI</span></Link>
          <span className="flow-divider"/>
          {editingName ? <input className="flow-project-input" aria-label="Project name" autoFocus value={projectName} onChange={e=>setProjectName(e.target.value)} onBlur={()=>rename(projectName)} onKeyDown={e=>{if(e.key==="Enter") rename(projectName); if(e.key==="Escape") setEditingName(false);}}/> :
          <button className="flow-project-name" title="Click to rename" onClick={()=>setEditingName(true)}>{projectName || "New project"}</button>}
          <details className="flow-menu"><summary aria-label="Project options"><MoreVertical size={18}/></summary><div className="flow-popover"><button onClick={()=>setEditingName(true)}>Rename project</button><button onClick={()=>{if(window.confirm("Delete this draft? Generated videos will not be deleted.")){localStorage.removeItem("singmotion-studio");localStorage.removeItem("singmotion-draft-id");localStorage.removeItem(`singmotion-project-name:${projectKey}`);window.location.href="/studio";}}}>Delete draft</button></div></details>
        </div>
        <div className="flow-header-right">
          <GlobalMenu />
          <Link href="/login" className="flow-profile" aria-label="Login"><UserRound size={21}/></Link>
        </div>
      </header>
      <main id="content" className={`flow-main ${draft.song ? "flow-has-audio" : "flow-empty"}`}>
        {!draft.song ? (
          <label className="flow-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void add(e.dataTransfer.files[0],"audio");}}>
            <img className="flow-upload-symbol" src="/media/upload-song.png" alt="" aria-hidden="true" />
            <strong>{busy ? "Uploading your song…" : "Upload your song…"}</strong>
            <span>Or click to choose an audio file</span>
            <small>MP3, WAV, M4A · up to 50 MB</small>
            <input type="file" aria-label="Choose audio file" accept=".mp3,.wav,.m4a" disabled={!ready||busy} onChange={e=>void add(e.target.files?.[0],"audio")}/>
          </label>
        ) : (
          <section className="flow-audio">
            <div className="flow-track">
              <div className="flow-track-art"><img src="/media/upload-song.png" alt="" aria-hidden="true" /></div>
              <div className="flow-track-meta"><strong title={draft.song.name}>{draft.song.name}</strong><small>{time(draft.song.duration || 0)}</small></div>
              <button className="flow-track-remove" aria-label="Remove song" onClick={()=>update({song:null})} disabled={busy}><Trash2 size={20}/></button>
            </div>
            <Waveform key={draft.song.id} url={`/api/assets/${draft.song.id}`} duration={draft.song.duration||1} start={draft.start} end={draft.end} onChange={(start,end)=>update({start,end})}/>
          </section>
        )}
        <section className="flow-composer" aria-label="Video settings">
          <label className="flow-composer-label" htmlFor="flow-performance-prompt">Describe your performance</label>
          <div className="flow-composer-top">
            {draft.imageId ? <div className="flow-photo"><img alt="Uploaded artist" src={`/api/assets/${encodeURIComponent(draft.imageId)}`}/><button aria-label="Remove photo" onClick={()=>update({imageId:""})}><X size={12}/></button></div> :
              <label className="flow-photo-add" title="Upload artist photo"><ImagePlus size={23}/><input type="file" accept=".jpg,.jpeg,.png" aria-label="Choose artist photo" disabled={!ready||busy} onChange={e=>void add(e.target.files?.[0],"image")}/></label>}
            <div className="flow-prompt-wrap"><textarea id="flow-performance-prompt" className="flow-prompt" maxLength={1000} rows={2} placeholder="Example: Singing with emotion, subtle movements, warm stage lighting…" value={draft.customPrompt} onChange={e=>update({customPrompt:e.target.value,performance:e.target.value.trim()?"Custom":"Natural"})}/></div>
          </div>
          <div className="flow-composer-bottom">
            <div className="flow-settings-group" role="group" aria-label="Video settings">
            <details className="flow-camera-menu"><summary aria-label="Camera mode"><Camera size={16}/><span>{draft.camera}</span><span className="flow-chevron">⌄</span></summary><div className="flow-camera-options" role="group" aria-label="Camera movements">{cameraOptions.map(option=><button key={option} type="button" className={option===draft.camera?"is-active":""} onClick={e=>{update({camera:option});e.currentTarget.closest("details")!.open=false;}}>{option}</button>)}</div></details>
            <label className="flow-select flow-format"><Smartphone size={18}/><select aria-label="Format" value={draft.outputFormat} onChange={e=>update({outputFormat:e.target.value as "9:16"|"16:9",formatMode:e.target.value as "9:16"|"16:9"})}><option value="9:16">9:16</option><option value="16:9">16:9</option></select></label>
            </div>
            <button className="flow-create" disabled={!available} title={!draft.song?"Add a song":!draft.imageId?"Add an artist photo":!audioValid?"Select a valid audio segment":!prompt?"Add a description":"Create video"} onClick={()=>setConfirm(true)}><Sparkles size={19}/>Create video <ArrowRight size={19}/></button>
          </div>
        </section>
        {!available && !!draft.song && <p className="flow-missing" role="status">{busy ? "Uploading…" : !draft.imageId ? "Add an artist photo to continue" : !audioValid ? "Select a valid audio segment" : !prompt ? "Add a performance description" : ""}</p>}
        {error && <p className="flow-error" role="alert">{error}</p>}
      </main>
      {confirm && selection && <GenerationDialog key={JSON.stringify(selection)} selection={selection} requestKey={projectKey} artistName={draft.artistName} onClose={()=>setConfirm(false)}/>}
    </div>
  );
}
