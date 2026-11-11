"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "./site-header";
import {
  ArrowLeft,
  ArrowRight,
  Music2,
  ImagePlus,
  Smartphone,
  Monitor,
  Sparkles,
  Plus,
  X,
  House,
  UserRound,
  Camera,
  Crop,
  RotateCw,
  FlipHorizontal2,
  SlidersHorizontal,
  LockKeyhole,
  UnlockKeyhole,
  ChevronDown,
  Play,
  Trash2,
  FileMusic,
  CloudUpload,
  Check,
  ShieldCheck,
} from "lucide-react";
import { ProductHeader } from "./product-header";
import { GenerationDialog } from "./generation-dialog";
import { PerformanceTimeline, timelinePrompt, type PerformanceSection } from "./performance-timeline";
import { api, ensureSession, upload, uploadWithProgress } from "@/lib/client";
import {
  composePrompt,
  validateSelection,
  validateFile,
  performances,
  cameras,
  cameraHelp,
  cameraPrompt,
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
const sourceTimestamp = (seconds: number) => {
  const ms = Math.max(0,Math.round(seconds*1000));
  const min = Math.floor(ms/60000);
  const sec = Math.floor(ms%60000/1000);
  const milli = String(ms%1000).padStart(3,"0");
  return `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}.${milli}`;
};
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
  const audioFileInput = useRef<HTMLInputElement>(null);
  const photoFileInput = useRef<HTMLInputElement>(null);
  const reviewTouch = useRef<{x:number;y:number}|null>(null);
  const draftId = useRef<string>(""),
    [saved, setSaved] = useState(false),
    [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState(""),
    [draft, setDraft] = useState(initial),
    [step, setStep] = useState(0),
    [timeline, setTimeline] = useState<PerformanceSection[]>([]),
    [owner, setOwner] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [audioUploadProgress, setAudioUploadProgress] = useState<number | null>(null),
    [audioUploadPhase, setAudioUploadPhase] = useState<"idle" | "uploading" | "processing">("idle"),
    [audioUploadingName, setAudioUploadingName] = useState(""),
    [error, setError] = useState(""),
    [reviewCard, setReviewCard] = useState<"preview"|"details">("preview"),
    [confirm, setConfirm] = useState(false),
    [detectedFormat, setDetectedFormat] = useState<"9:16" | "16:9">("9:16"),
    [cropZoom,setCropZoom] = useState(1),
    [cropX,setCropX] = useState(50),
    [cropY,setCropY] = useState(50),
    [cropPending,setCropPending] = useState(false),
    [rotation,setRotation] = useState(0),
    [flipped,setFlipped] = useState(false),
    [editTool,setEditTool] = useState<"crop"|"adjust">("crop"),
    [customWidth,setCustomWidth] = useState(1080),
    [customHeight,setCustomHeight] = useState(1920),
    [lockRatio,setLockRatio] = useState(true),
    [brightness,setBrightness] = useState(100),
    [contrast,setContrast] = useState(100);
  const cropReset=()=>{setCropZoom(1);setCropX(50);setCropY(50);setRotation(0);setFlipped(false);setBrightness(100);setContrast(100);setEditTool("crop");};
  const customMode=draft.formatMode==="auto";
  const frameWidth=customMode?customWidth:(draft.outputFormat==="9:16"?1080:1920);
  const frameHeight=customMode?customHeight:(draft.outputFormat==="9:16"?1920:1080);
  const frameValid=Number.isInteger(frameWidth)&&Number.isInteger(frameHeight)&&frameWidth>=256&&frameHeight>=256&&frameWidth<=4096&&frameHeight<=4096&&frameWidth*frameHeight<=16777216;
  function setCustomDimension(axis:"width"|"height",raw:number) {
    const value=Math.round(raw);
    if(!Number.isFinite(value))return;
    if(axis==="width"){
      setCustomWidth(value);
      if(lockRatio)setCustomHeight(Math.round(value*customHeight/Math.max(1,customWidth)));
    } else {
      setCustomHeight(value);
      if(lockRatio)setCustomWidth(Math.round(value*customWidth/Math.max(1,customHeight)));
    }
    if(draft.imageId)setCropPending(true);
  }
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
"Draft could not be saved on the server. Your browser draft is retained; retry before leaving.",
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
      section.start<0||section.end>duration+0.00001||section.end-section.start<0.5||
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
    if (kind === "audio") {
      setAudioUploadingName(file.name);
      setAudioUploadProgress(0);
      setAudioUploadPhase("uploading");
    }
    try {
      validateFile(file.name, file.size, kind);
      const asset = kind === "audio"
        ? await uploadWithProgress(file, kind, percent => {
            setAudioUploadProgress(percent);
            if (percent === 100) setAudioUploadPhase("processing");
          })
        : await upload(file, kind);
      if (kind === "audio")
        update({
          song: asset,
          start: 0,
          end: Math.min(5, asset.duration || 5),
        });
      else {
        const detected = photoFormat(asset.width, asset.height);
        setDetectedFormat(detected);
        cropReset();setCropPending(true);
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
      if (kind === "audio") { setAudioUploadPhase("idle"); setAudioUploadProgress(null); setAudioUploadingName(""); }
    }
  }
  async function applyPhotoFraming() {
    if(!draft.imageId)return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/assets/"+encodeURIComponent(draft.imageId));
      if(!response.ok)throw new Error("Could not load artist photo.");
      const bitmap=await createImageBitmap(await response.blob());
      try {
        const portrait=draft.outputFormat==="9:16";
        const width=portrait?720:1280, height=portrait?1280:720;
        const scale=Math.max(width/bitmap.width,height/bitmap.height)*cropZoom;
        const visibleWidth=width/scale, visibleHeight=height/scale;
        const canvas=document.createElement("canvas");
        canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext("2d");
        if(!ctx)throw new Error("Photo editor unavailable.");
        ctx.drawImage(bitmap,(bitmap.width-visibleWidth)*cropX/100,(bitmap.height-visibleHeight)*cropY/100,visibleWidth,visibleHeight,0,0,width,height);
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Could not save crop.")),"image/png"));
        const asset=await upload(new File([blob],"artist-framed.png",{type:"image/png"}),"image");
        update({imageId:asset.id,formatMode:draft.outputFormat});
        cropReset();setCropPending(false);
      } finally {bitmap.close();}
    } catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
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

  const available = !!selection && audioValid && !!prompt && !busy && !cropPending && frameValid;
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
  return (
    <div className="product-theme singmotion-flow">
      <SiteHeader />
      <main id="content" className={`flow-main ${draft.song ? "flow-has-audio" : "flow-empty"}`}>
        <div className="sm-new-stepper" aria-label="Video creation progress">
          {["Audio Upload", "Photo Upload", "Performance Prompt", "Generate Video"].map((label,index)=>(
            <div key={label} className={`sm-new-step ${index===step?"is-current":""} ${index<step?"is-complete":""}`} aria-current={index===step?"step":undefined}>
              <span className="sm-new-step-dot">{index<step?<Check size={21}/>:index+1}</span>
              <span className="sm-new-step-label">{label}</span>
            </div>
          ))}
        </div>
        <div className="sm-new-page-heading"><span>Step {step+1} of 4 · {["Audio","Photo","Performance","Generate"][step]}</span><h1>{step===0 && draft.song ? content.audioReadyHeadline : ["Upload your audio",draft.imageId?"Your artist photo":"Upload your artist photo","Describe your performance","Generate your video"][step]}</h1><p>{step===0 && draft.song ? content.audioReadySubtitle : ["Upload the audio file you’ll use for the music video.","Upload a clear photo and choose the video format.","Set how your artist moves and performs.","Review your creation before generating."][step]}</p></div>
        
        {step===0&&<div className="sm-new-audio-workspace">
          <input ref={audioFileInput} className="sr-only" type="file" aria-label="Choose audio file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" disabled={!ready||busy} onChange={e=>{void add(e.target.files?.[0],"audio");e.currentTarget.value="";}}/>
          {!draft.song?(
            <button type="button" className="sm-new-upload-zone" disabled={!ready||busy} onClick={()=>audioFileInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void add(e.dataTransfer.files[0],"audio");}}>
              <span className="sm-new-upload-icon"><CloudUpload size={70}/><Music2 size={30}/></span>
              <strong>{audioUploadPhase === "uploading" ? "Uploading your audio…" : audioUploadPhase === "processing" ? "Processing your audio…" : "Drop your audio here or tap to browse"}</strong>
              {audioUploadPhase !== "idle" ? (
                <div className="sm-audio-upload-feedback" role="status" aria-live="polite">
                  <span className="sm-audio-upload-filename" title={audioUploadingName}>{audioUploadingName}</span>
                  <div className="sm-audio-upload-progress" role="progressbar" aria-label="Audio upload progress"
                    aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={audioUploadProgress === null ? undefined : audioUploadProgress}
                    aria-valuetext={audioUploadPhase === "processing" ? "Upload complete; processing audio" : audioUploadProgress === null ? "Uploading audio" : audioUploadProgress + "% uploaded"}>
                    <span style={{width: audioUploadProgress === null ? "100%" : audioUploadProgress + "%"}} className={audioUploadProgress === null || audioUploadPhase === "processing" ? "is-indeterminate" : ""}/>
                  </div>
                  <span>{audioUploadPhase === "processing"
                    ? "Upload complete. Reading audio duration and waveform…"
                    : audioUploadProgress === null ? "Sending file…"
                    : audioUploadProgress + "% uploaded"}</span>
                </div>
              ) : <span>MP3, WAV, M4A · up to 50 MB</span>}
            </button>
          ):(
            <>
              <div className="sm-new-file-card">
                <span className="sm-new-file-icon"><Music2 size={27}/></span>
                <div className="sm-new-file-info"><strong>{draft.song.name}</strong><span>{sourceTimestamp(draft.song.duration||0)} · Selected clip {sourceTimestamp(draft.start)}–{sourceTimestamp(draft.end)} ({sourceTimestamp(Math.max(0,draft.end-draft.start))})</span></div>
                <button className="sm-new-file-delete" type="button" aria-label="Delete audio" title="Delete audio" disabled={busy} onClick={()=>update({song:null,start:0,end:10})}><Trash2 size={20}/></button>
              </div>
              <div className="sm-new-wave-card">
                <Waveform key={draft.song.id} url={`/api/assets/${draft.song.id}${/\.(wav|m4a)$/i.test(draft.song.name)?"?playback=1":""}`} duration={draft.song.duration||1} start={draft.start} end={draft.end} onChange={(start,end)=>update({start,end})} filename={draft.song.name}/>
              </div>
            </>
          )}
          <p className="sm-new-private"><ShieldCheck size={17}/> Your audio stays private in your workspace.</p>
        </div>}
        {step===1&&<section className="sm-photo-step" aria-label="Artist photo and video format">
          <input ref={photoFileInput} type="file" className="sr-only" accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            aria-label="Choose artist photo" disabled={!ready||busy}
            onChange={e=>{void add(e.target.files?.[0],"image");e.currentTarget.value="";}}/>
          {!draft.imageId ? (
            <button type="button" className="sm-photo-upload-zone" disabled={!ready||busy}
              onClick={()=>photoFileInput.current?.click()} onDragOver={e=>e.preventDefault()}
              onDrop={e=>{e.preventDefault();void add(e.dataTransfer.files?.[0],"image");}}>
              <span className="sm-photo-upload-icon"><ImagePlus size={40} strokeWidth={1.65}/></span>
              <strong>{busy?"Uploading your photo…":"Drop a photo here or tap to browse"}</strong>
              <span>JPG, PNG · up to 30 MB · clear front-facing portrait recommended</span>
            </button>
          ) : (
            <div className="sm-photo-preview-shell">
              <div className="sm-photo-preview-frame" style={{aspectRatio:draft.outputFormat==="9:16"?"9 / 16":"16 / 9"}}>
                <img src={"/api/assets/"+encodeURIComponent(draft.imageId)} alt="Artist photo cropping preview"
                  style={{objectPosition:cropX+"% "+cropY+"%",width:(cropZoom*100)+"%",height:(cropZoom*100)+"%",left:((1-cropZoom)*cropX)+"%",top:((1-cropZoom)*cropY)+"%"}}/>
              </div>
              <div className="sm-photo-preview-actions">
                <span><Check size={17}/> {cropPending?"Adjust and apply framing":"Photo ready · "+draft.outputFormat}</span>
                <div>
                  <button type="button" disabled={busy} onClick={()=>photoFileInput.current?.click()}><ImagePlus size={16}/> Replace</button>
                  <button className="sm-new-file-delete" type="button" disabled={busy} aria-label="Delete artist photo" title="Delete artist photo"
                    onClick={()=>{update({imageId:""});cropReset();setCropPending(false);}}><Trash2 size={20}/></button>
                </div>
              </div>
            </div>
          )}
          <div className="sm-photo-formats" role="group" aria-label="Video format">
            <p>Choose video format</p>
            <div className="sm-photo-format-choices">
              <button type="button" aria-pressed={draft.outputFormat==="9:16"} className={draft.outputFormat==="9:16"?"is-selected":""}
                onClick={()=>{update({formatMode:"9:16",outputFormat:"9:16"});cropReset();if(draft.imageId)setCropPending(true);}}>
                <Smartphone size={18}/><strong>9:16</strong><small>Portrait</small>
              </button>
              <button type="button" aria-pressed={draft.outputFormat==="16:9"} className={draft.outputFormat==="16:9"?"is-selected":""}
                onClick={()=>{update({formatMode:"16:9",outputFormat:"16:9"});cropReset();if(draft.imageId)setCropPending(true);}}>
                <Monitor size={18}/><strong>16:9</strong><small>Landscape</small>
              </button>
            </div>
          </div>
          {draft.imageId&&<div className="sm-photo-framing" role="group" aria-label="Photo framing">
            <strong>Adjust framing</strong>
            <div className="sm-photo-framing-sliders">
              <label>Zoom <input type="range" aria-label="Photo zoom" min="1" max="2.5" step=".05" value={cropZoom} onChange={e=>{setCropZoom(+e.target.value);setCropPending(true);}}/></label>
              <label>Horizontal <input type="range" aria-label="Horizontal framing" min="0" max="100" value={cropX} onChange={e=>{setCropX(+e.target.value);setCropPending(true);}}/></label>
              <label>Vertical <input type="range" aria-label="Vertical framing" min="0" max="100" value={cropY} onChange={e=>{setCropY(+e.target.value);setCropPending(true);}}/></label>
            </div>
            <div className="sm-photo-framing-actions">
              <button type="button" onClick={()=>{cropReset();setCropPending(true);}}>Reset</button>
              <button type="button" className="sm-photo-apply" disabled={busy||!cropPending} onClick={()=>void applyPhotoFraming()}>
                {busy?"Saving…":"Apply framing"}
              </button>
            </div>
          </div>}
          <p className="sm-photo-step-tip"><ShieldCheck size={17}/> Use a well-lit image with the full face visible. Video export supports 9:16 and 16:9.</p>
        </section>}
        {step===2&&<section className="sm-performance-prompt-step" aria-label="Performance and camera settings">
          <PerformanceTimeline duration={draft.end-draft.start} audioStart={draft.start}
            audioUrl={draft.song?`/api/assets/${draft.song.id}${/\.(wav|m4a)$/i.test(draft.song.name)?"?playback=1":""}`:undefined}
            sections={timeline} onChange={updateTimeline}/>
          <div className="flow-settings-group" role="group" aria-label="Camera movement">
            <details className="flow-camera-menu">
              <summary aria-label="Add camera movement"><Camera size={16}/><span>Add camera</span><ChevronDown className="flow-chevron" size={16}/></summary>
              <div className="flow-camera-options" role="group" aria-label="Camera movements">
                {cameraOptions.map(option=><button type="button" key={option} className={option===draft.camera?"is-active":""}
                  onClick={e=>{update({camera:option});e.currentTarget.closest("details")!.open=false;}}
                  title={cameraHelp[option as keyof typeof cameraHelp]||option}>{option}<small>{cameraHelp[option as keyof typeof cameraHelp]||""}</small>
                </button>)}
              </div>
            </details>
          </div>
          <div className="flow-prompt-wrap">
            <label className="flow-composer-label" htmlFor="flow-performance-prompt">Describe your performance (optional)</label>
            <textarea ref={performanceInput} id="flow-performance-prompt" className="flow-prompt" maxLength={1000} rows={3}
              placeholder="e.g. Singing with emotion, subtle movements, warm stage lighting…"
              value={draft.customPrompt} onChange={e=>update({customPrompt:e.target.value,performance:e.target.value.trim()?"Custom":"Natural"})}/>
          </div>
        </section>}
        {step===3&&<section className="sm-studio-review-carousel" aria-label="Project preview carousel">
          <div className="sm-carousel-stage sm-review-stage"
            onTouchStart={e=>{reviewTouch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}}
            onTouchEnd={e=>{const from=reviewTouch.current;reviewTouch.current=null;if(!from)return;const dx=e.changedTouches[0].clientX-from.x,dy=e.changedTouches[0].clientY-from.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4)setReviewCard(value=>value==="preview"?"details":"preview");}}
          >
            <article className={"sm-carousel-card sm-review-panel sm-review-front "+(reviewCard==="preview"?"is-active is-front":"is-neighbor is-inactive is-behind")} style={{"--distance":reviewCard==="preview"?0:-1,"--depth":reviewCard==="preview"?0:1,"--drag":0} as React.CSSProperties} aria-label="Project image and status">
              {draft.imageId?<img className="sm-review-cover" style={{objectFit:"cover",objectPosition:"center"}} src={`/api/assets/${encodeURIComponent(draft.imageId)}`} alt={`Selected artist centered for ${draft.outputFormat} output`}/>:<div className="sm-review-placeholder"><ImagePlus size={42}/><span>No artist image selected</span></div>}
              <div className="sm-review-top"><span className="sm-review-status">Ready for review</span></div>
              <div className="sm-review-bottom"><strong title={projectName}>{projectName||"Untitled Project"}</strong><span>{draft.outputFormat} · {sourceTimestamp(Math.max(0,draft.end-draft.start))} clip</span></div>
              {reviewCard!=="preview"&&<button type="button" className="sm-carousel-side-hit sm-review-side-hit" aria-label="Show project card" onClick={()=>setReviewCard("preview")}/>}
            </article>
            <article className={"sm-carousel-card sm-review-panel sm-review-details "+(reviewCard==="details"?"is-active is-front":"is-neighbor is-inactive is-behind")} style={{"--distance":reviewCard==="details"?0:1,"--depth":reviewCard==="details"?0:1,"--drag":0} as React.CSSProperties} aria-label="Project details">
              <div className="sm-review-details-inner">
                <h2>Project details</h2>
                <dl>
                  <div><dt>Project</dt><dd>{projectName||"Untitled Project"}</dd></div>
                  <div><dt>Status</dt><dd>Ready for review</dd></div>
                  <div><dt>Song</dt><dd>{draft.song?.name||"Missing audio"}</dd></div>
                  <div><dt>Source audio cut</dt><dd>Start {sourceTimestamp(draft.start)} · End {sourceTimestamp(draft.end)}</dd></div>
                  <div><dt>Clip duration</dt><dd>{sourceTimestamp(Math.max(0,draft.end-draft.start))}</dd></div>
                  <div><dt>Video format</dt><dd>{draft.outputFormat}</dd></div>
                </dl>
                <div className="sm-review-instructions"><strong>Final performance instructions</strong><p>{draft.customPrompt||"No additional instructions"}</p></div>
              </div>
              {reviewCard!=="details"&&<button type="button" className="sm-carousel-side-hit sm-review-side-hit" aria-label="Show project details" onClick={()=>setReviewCard("details")}/>}
            </article>
          </div>
        </section>}
        <nav className="sm-studio-navigation sm-new-navigation" aria-label="Studio steps">
          <button className="sm-studio-back" type="button" onClick={()=>step===0?window.location.assign("/"):setStep(x=>Math.max(0,x-1))}><ArrowLeft size={19}/> Back</button>
          {step<3&&<button type="button" className="sm-studio-next" disabled={busy||(step===0&&!audioValid)||(step===1&&!draft.imageId)} onClick={()=>setStep(x=>Math.min(3,x+1))}>Continue <ArrowRight size={19}/></button>}
          {step===3&&<button type="button" className="sm-studio-next" disabled={!available} onClick={()=>setConfirm(true)}>Generate Video <ArrowRight size={19}/></button>}
        </nav>
        {error && <p className="flow-error" role="alert">{error} {error.includes("3 guest drafts") && <Link href="/login">Log in</Link>}</p>}
        <div className="sm-studio-scroll-spacer" aria-hidden="true" />
      </main>
      {confirm && selection && <GenerationDialog key={JSON.stringify(selection)} selection={selection} requestKey={projectKey} artistName={draft.artistName} projectName={projectName} songName={draft.song?.name || "Audio"} onClose={()=>setConfirm(false)}/>}
    </div>
  );
}
