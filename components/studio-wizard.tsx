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
  ChevronDown,
  Play,
  Trash2,
  FileMusic,
} from "lucide-react";
import { ProductHeader } from "./product-header";
import { GenerationDialog } from "./generation-dialog";
import { PerformanceTimeline, timelinePrompt, type PerformanceSection } from "./performance-timeline";
import { api, ensureSession, upload } from "@/lib/client";
import {
  composePrompt,
  validateSelection,
  validateFile,
  performances,
  cameras,
  cameraHelp,
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
  const firstDraftSave = useRef(true);
  const deletingDraft = useRef(false);
  const performanceInput = useRef<HTMLTextAreaElement>(null);
  const draftId = useRef<string>(""),
    [saved, setSaved] = useState(false),
    [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState(""),
    [editingName, setEditingName] = useState(false),
    [draft, setDraft] = useState(initial),
    [step, setStep] = useState(0),
    [timeline, setTimeline] = useState<PerformanceSection[]>([]),
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
        try { setTimeline(JSON.parse(localStorage.getItem(`singmotion-timeline:${draftId.current}`)||"[]")); } catch {}
        setProjectName(localStorage.getItem(`singmotion-project-name:${draftId.current}`) || new Date().toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }));
        if (requested) {
          const saved = await api<{
            selection: StudioDraftExport;
            song: Asset | null;
            image: Asset | null;
            artistName: string;
            projectName?: string;
            step: number;
          }>(`studio-drafts/${encodeURIComponent(requested)}`);
          if (!current) return;
          setProjectName(saved.projectName || localStorage.getItem(`singmotion-project-name:${requested}`) || saved.artistName || "Untitled Project");
          setDraft({
            ...initial,
            ...saved.selection,
            song: saved.song,
            artistName: saved.artistName,
          });
          // Drafts already saved by the four-step wizard use 0–3 unchanged.
          // Earlier five-step drafts used 3 for performance and 4 for review.
          setStep(Math.max(0, Math.min(3, saved.step)));
          try { setTimeline(JSON.parse(localStorage.getItem(`singmotion-timeline:${requested}`)||"[]")); } catch {}
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
                  fresh = { ...initial, song, start: 0, end: Math.min(5, song.duration || 5) };
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
    if (!ready || !owner || !projectKey || deletingDraft.current) return;
    let current = true;
    const id = projectKey;
    // Register a new empty draft immediately when Studio opens.
    // Later edits retain the debounce to avoid excessive server writes.
    const delay = firstDraftSave.current ? 0 : 700;
    const timer = setTimeout(() => {
      firstDraftSave.current = false;
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
              projectName,
              step,
            }),
          }),
        )
        .then(() => {
          if (current) setSaved(true);
        })
        .catch((cause) => {
          if (current)
            setError(
              (cause as Error).message.includes("limit of 3 drafts")
                ? "You have used all 3 guest drafts. Log in to create more drafts."
                : "Draft could not be saved on the server. Your browser draft is retained; retry before leaving.",
            );
        });
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [draft, step, owner, ready, projectKey, projectName]);
  // Grow with the content (including restored drafts), capped to keep the composer compact.
  useEffect(() => {
    const field = performanceInput.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(240, Math.max(68, field.scrollHeight))}px`;
  }, [draft.customPrompt]);
  function updateTimeline(next: PerformanceSection[]) {
    // Reject overlaps and out-of-range sections before they can alter the final prompt.
    const ordered=[...next].sort((a,b)=>a.start-b.start);
    const duration=Math.max(0,draft.end-draft.start);
    if(ordered.some((section,i)=>!Number.isFinite(section.start)||!Number.isFinite(section.end)||
      section.start<0||section.end>Math.ceil(duration)||section.end-section.start<0.5||
      (i>0&&section.start<ordered[i-1].end))) {
      setError("Sections must not overlap and must stay within the selected audio duration.");
      return;
    }
    setTimeline(next);
    update({customPrompt:timelinePrompt(next),performance:next.length?"Custom":"Natural"});
    if(projectKey)localStorage.setItem(`singmotion-timeline:${projectKey}`,JSON.stringify(next));
  }
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
          end: Math.min(5, asset.duration || 5),
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
  const deleteCurrentDraft = async () => {
    if (!projectKey || deletingDraft.current ||
        !window.confirm("Permanently delete this draft? This frees one of your 3 guest draft slots. Generated videos will not be deleted.")) return;
    deletingDraft.current = true;
    setBusy(true);
    setError("");
    try {
      // Await pending autosaves so they cannot recreate the deleted draft.
      await saveQueue.current.catch(() => {});
      await api(`studio-drafts/${encodeURIComponent(projectKey)}`, { method: "DELETE" });
      localStorage.removeItem("singmotion-studio");
      localStorage.removeItem("singmotion-draft-id");
      localStorage.removeItem(`singmotion-project-name:${projectKey}`);
      localStorage.removeItem(`singmotion-timeline:${projectKey}`);
      window.location.assign("/");
    } catch (cause) {
      deletingDraft.current = false;
      setError((cause as Error).message || "Draft could not be deleted.");
      setBusy(false);
    }
  };
  return (
    <div className="product-theme singmotion-flow">
      <header className="flow-header">
        <div className="flow-header-left">
          <Link href="/" aria-label="SingMotion AI home" className="sm-wordmark">SingMotion <span>AI</span></Link>
          <span className="flow-divider"/>
          {editingName ? <input className="flow-project-input" aria-label="Project name" autoFocus value={projectName} onChange={e=>setProjectName(e.target.value)} onBlur={()=>rename(projectName)} onKeyDown={e=>{if(e.key==="Enter") rename(projectName); if(e.key==="Escape") setEditingName(false);}}/> :
          <button className="flow-project-name" title="Click to rename" onClick={()=>setEditingName(true)}>{projectName || "New project"}</button>}
          <details className="flow-menu"><summary aria-label="Project options"><MoreVertical size={18}/></summary><div className="flow-popover"><button onClick={()=>setEditingName(true)}>Rename project</button><button type="button" disabled={busy} onClick={()=>void deleteCurrentDraft()}>Delete draft</button></div></details>
        </div>
        <div className="flow-header-right">
          <GlobalMenu openInNewTab />
          <Link href="/login" className="flow-profile" aria-label="Login"><UserRound size={21}/></Link>
        </div>
      </header>
      <main id="content" className={`flow-main ${draft.song ? "flow-has-audio" : "flow-empty"}`}>
        <div className="sm-studio-step-title"><span>Step {step+1} of 4</span><h1>{["Audio selection","Performance Timeline","Photo & Video Format","Generate Video"][step]}</h1></div>
        {step===0&&<div className="flow-workspace sm-studio-audio-step"><div className="flow-workspace-media">
          {!draft.song?<label className="flow-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void add(e.dataTransfer.files[0],"audio");}}>
            <FileMusic className="flow-upload-symbol" size={47}/><strong>{busy?"Uploading your song…":"Upload audio"}</strong><span>Click to add your song</span><small>MP3, WAV, M4A · up to 50 MB</small>
            <input type="file" aria-label="Choose audio file" accept=".mp3,.wav,.m4a" disabled={!ready||busy} onChange={e=>void add(e.target.files?.[0],"audio")}/>
          </label>:<section className="flow-audio"><Waveform key={draft.song.id} url={`/api/assets/${draft.song.id}${/\\.(wav|m4a)$/i.test(draft.song.name)?"?playback=1":""}`} duration={draft.song.duration||1} start={draft.start} end={draft.end} onChange={(start,end)=>update({start,end})} filename={draft.song.name} onRemove={()=>update({song:null})} removeDisabled={busy}/></section>}
        </div></div>}
        {step===1&&<PerformanceTimeline duration={Math.max(1,draft.end-draft.start)} sections={timeline} onChange={updateTimeline}/>}
        {step===2&&<div className="sm-studio-photo-step"><h2>Upload your artist photo</h2><p>Choose the reference image and output format for your music video.</p>
          <div className="sm-studio-photo-card">{draft.imageId?<div className="flow-photo"><img alt="Uploaded artist" src={`/api/assets/${encodeURIComponent(draft.imageId)}`}/><button type="button" aria-label="Remove photo" onClick={()=>update({imageId:""})}><X size={16}/></button></div>:
            <label className="flow-photo-add"><ImagePlus size={38}/><span>Add image</span><input type="file" accept=".jpg,.jpeg,.png" aria-label="Choose artist photo" disabled={!ready||busy} onChange={e=>void add(e.target.files?.[0],"image")}/></label>}</div>
          <div className="sm-studio-formats" role="group" aria-label="Video aspect ratio">{(["9:16","16:9"] as const).map(format=><button type="button" key={format} aria-pressed={draft.outputFormat===format} onClick={()=>update({outputFormat:format,formatMode:format})}>{format==="9:16"?<Smartphone size={25}/>:<Monitor size={25}/>}<strong>{format}</strong><span>{format==="9:16"?"Portrait":"Landscape"}</span></button>)}</div>
        </div>}
        {step===3&&<section className="sm-studio-review"><Sparkles size={38}/><h2>Ready to generate your video?</h2><p>Review your selection before continuing to generation.</p>
          <div><span>Song</span><strong>{draft.song?.name||"Missing audio"}</strong></div><div><span>Duration</span><strong>{Math.max(0,draft.end-draft.start).toFixed(1)} seconds</strong></div><div><span>Performance</span><strong>{timeline.length} timeline sections</strong></div><div><span>Video format</span><strong>{draft.outputFormat}</strong></div>
          <button type="button" className="sm-studio-generate" disabled={!available} onClick={()=>setConfirm(true)}>Generate Video <ArrowRight size={20}/></button>
          <p>After generation, your project page shows the preview and result when available.</p>
        </section>}
        <nav className="sm-studio-navigation" aria-label="Studio steps">
          {step===0?<Link href="/" className="sm-studio-back"><ArrowLeft size={19}/> Back</Link>:<button className="sm-studio-back" type="button" onClick={()=>setStep(x=>Math.max(0,x-1))}><ArrowLeft size={19}/> Back</button>}
          {step<3&&<button type="button" className="sm-studio-next" disabled={busy||(step===0&&!audioValid)||(step===2&&!draft.imageId)} onClick={()=>setStep(x=>Math.min(3,x+1))}>Continue <ArrowRight size={19}/></button>}
        </nav>
        {error && <p className="flow-error" role="alert">{error} {error.includes("3 guest drafts") && <Link href="/login">Log in</Link>}</p>}
      </main>
      {confirm && selection && <GenerationDialog key={JSON.stringify(selection)} selection={selection} requestKey={projectKey} artistName={draft.artistName} projectName={projectName} songName={draft.song?.name || "Audio"} onClose={()=>setConfirm(false)}/>}
    </div>
  );
}
