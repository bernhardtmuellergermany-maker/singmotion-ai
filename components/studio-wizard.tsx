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
  Heart,
  Clapperboard,
  Video,
  Plus,
  X,
  House,
  UserRound,
  Camera,
  Crop,
  RotateCw,
  FlipHorizontal2,
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
// Reserved for a possible future Pro tier; leave existing timeline and camera editor intact.
const advancedPerformanceToolsEnabled = false;
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
  formatMode: "9:16" as "auto" | "9:16" | "16:9",
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
    [photoUploadProgress,setPhotoUploadProgress] = useState<number|null>(null),
    [photoUploadPhase,setPhotoUploadPhase] = useState<"idle"|"uploading"|"processing">("idle"),
    [photoUploadingName,setPhotoUploadingName] = useState(""),
    [photoSize,setPhotoSize] = useState({width:1,height:1}),
    [error, setError] = useState(""),
    [reviewCard, setReviewCard] = useState<"preview"|"details">("preview"),
    [confirm, setConfirm] = useState(false),
    [detectedFormat, setDetectedFormat] = useState<"9:16" | "16:9">("9:16"),
    [cropX,setCropX] = useState(50),
    [cropY,setCropY] = useState(50),
    [cropPending,setCropPending] = useState(false),
    [rotation,setRotation] = useState(0),
    [flipped,setFlipped] = useState(false),
    [customWidth,setCustomWidth] = useState(720),
    [customHeight,setCustomHeight] = useState(1280),
    [cropScale,setCropScale] = useState(1),
    [lockRatio,setLockRatio] = useState(true),
    [imageReady,setImageReady] = useState(false);
  const cropDrag=useRef<{x:number;y:number;startX:number;startY:number}|null>(null);
  const handleDrag=useRef<{id:number;x:number;y:number;scale:number;corner:string;width:number;height:number;ratio:number}|null>(null);
  // BytePlus receives the cropped reference image. Free crop changes its
  // aspect ratio; the fixed 9:16 and 16:9 presets only change framing.
  function dimensionForRatio(rawRatio:number){
    const ratio=Math.min(2.5,Math.max(0.4,rawRatio));
    const width=ratio>=1?Math.round(720*ratio):720;
    const height=ratio>=1?720:Math.round(720/ratio);
    return {width,height};
  }
  function startCropHandle(e:React.PointerEvent<HTMLSpanElement>,corner:string){
    if(busy||!imageReady)return;
    const rect=e.currentTarget.parentElement?.getBoundingClientRect();
    if(!rect)return;
    e.preventDefault();e.stopPropagation();
    handleDrag.current={id:e.pointerId,x:e.clientX,y:e.clientY,scale:cropScale,corner,width:rect.width,height:rect.height,ratio:frameWidth/frameHeight};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveCropHandle(e:React.PointerEvent<HTMLSpanElement>){
    const drag=handleDrag.current;
    if(!drag||drag.id!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();
    if(customMode){
      // In Crop mode corners reshape the crop rectangle; no zooming.
      // The opposite corner is the visual anchor for the drag.
      const horizontal=drag.corner.endsWith("r")?1:-1;
      const vertical=drag.corner.startsWith("b")?1:-1;
      const widthFactor=Math.max(0.25,1+(e.clientX-drag.x)*horizontal/Math.max(1,drag.width));
      const heightFactor=Math.max(0.25,1+(e.clientY-drag.y)*vertical/Math.max(1,drag.height));
      const size=dimensionForRatio(drag.ratio*widthFactor/heightFactor);
      setCustomWidth(size.width);
      setCustomHeight(size.height);
    }else{
      const horizontal=drag.corner.endsWith("r")?-1:1;
      const vertical=drag.corner.startsWith("b")?-1:1;
      const delta=((e.clientX-drag.x)*horizontal/Math.max(1,drag.width)
        +(e.clientY-drag.y)*vertical/Math.max(1,drag.height));
      setCropScale(Math.max(1,Math.min(3,drag.scale*(1+delta))));
    }
    setCropPending(true);
  }
  function endCropHandle(e:React.PointerEvent<HTMLSpanElement>){
    if(handleDrag.current?.id!==e.pointerId)return;
    handleDrag.current=null;
    e.stopPropagation();
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const cropReset=()=>{setCropX(50);setCropY(50);setCropScale(1);setRotation(0);setFlipped(false);};
  const customMode=draft.formatMode==="auto";
  const frameWidth=customMode?customWidth:(draft.outputFormat==="9:16"?720:1280);
  const frameHeight=customMode?customHeight:(draft.outputFormat==="9:16"?1280:720);
  const frameValid=Number.isInteger(frameWidth)&&Number.isInteger(frameHeight)&&frameWidth>=256&&frameHeight>=256&&frameWidth<=4096&&frameHeight<=4096&&frameWidth*frameHeight<=16777216;
  const rotatedImageWidth=rotation%180?photoSize.height:photoSize.width;
  const rotatedImageHeight=rotation%180?photoSize.width:photoSize.height;
  const coverScale=Math.max(1/rotatedImageWidth,frameHeight/(frameWidth*rotatedImageHeight))*cropScale;
  const previewImageWidth=photoSize.width*coverScale*100;
  const previewImageHeight=photoSize.height*coverScale*frameWidth/frameHeight*100;
  const cropExcessX=rotatedImageWidth*coverScale-1;
  const cropExcessY=rotatedImageHeight*coverScale*frameWidth/frameHeight-1;
  const cropOffsetX=(0.5-cropX/100)*cropExcessX*100;
  const cropOffsetY=(0.5-cropY/100)*cropExcessY*100;
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
    if (kind === "image") {setPhotoUploadingName(file.name);setPhotoUploadProgress(0);setPhotoUploadPhase("uploading");}
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
        : await uploadWithProgress(file,kind,percent=>{
            setPhotoUploadProgress(percent);
            if(percent===100)setPhotoUploadPhase("processing");
          });
      if (kind === "audio")
        update({
          song: asset,
          start: 0,
          end: Math.min(5, asset.duration || 5),
        });
      else {
        const detected = photoFormat(asset.width, asset.height);
        setDetectedFormat(detected);
        cropReset();setPhotoSize({width:asset.width||1,height:asset.height||1});setImageReady(false);setCropPending(true);
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
      else {setPhotoUploadPhase("idle");setPhotoUploadProgress(null);setPhotoUploadingName("");}
    }
  }
  async function applyPhotoFraming() {
    if(!draft.imageId||!frameValid)return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/assets/"+encodeURIComponent(draft.imageId));
      if(!response.ok)throw new Error("Could not load artist photo.");
      const bitmap=await createImageBitmap(await response.blob());
      try {
        const width=frameWidth,height=frameHeight;
        const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext("2d");
        if(!ctx)throw new Error("Photo editor unavailable.");
        const rotated=rotation%180!==0;
        const sourceW=rotated?bitmap.height:bitmap.width;
        const sourceH=rotated?bitmap.width:bitmap.height;
        const scale=Math.max(width/sourceW,height/sourceH)*cropScale;
        const translatedX=(0.5-cropX/100)*(sourceW*scale-width);
        const translatedY=(0.5-cropY/100)*(sourceH*scale-height);
        ctx.save();ctx.translate(width/2+translatedX,height/2+translatedY);
        ctx.scale(flipped?-1:1,1);ctx.rotate(rotation*Math.PI/180);ctx.scale(scale,scale);
        ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2);ctx.restore();
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Could not save crop.")),"image/png"));
        const asset=await upload(new File([blob],"artist-framed.png",{type:"image/png"}),"image");
        update({imageId:asset.id,outputFormat:width>=height?"16:9":"9:16"});
        cropReset();setPhotoSize({width,height});setImageReady(false);setCropPending(false);
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
        <div className="sm-new-stepper sm-new-stepper-animated" style={{"--sm-step-progress":String(step/3),"--sm-step-index":String(step)} as React.CSSProperties} aria-label="Video creation progress">
          <div className="sm-stepper-rail" aria-hidden="true"><span className="sm-stepper-fill"/><span className="sm-stepper-moving-glow"/></div>
          {["Audio", "Photo", "Performance", "Generate"].map((label,index)=>(
            <div key={label} className={`sm-new-step ${index===step?"is-current":""} ${index<step?"is-complete":""}`} aria-current={index===step?"step":undefined}>
              <span className="sm-new-step-dot">{index<step?<Check size={20}/>:index+1}</span>
              <span className="sm-new-step-label">{label}</span>
            </div>
          ))}
        </div>
        <div className={`sm-new-page-heading ${step===2?"sm-performance-heading":""}`}><span>Step {step+1} of 4 · {["Audio","Photo","Performance","Generate"][step]}</span><h1>{step===0 && draft.song ? content.audioReadyHeadline : ["Upload your audio",draft.imageId?"Your artist photo":"Upload your artist photo","How should your artist perform?","Generate your video"][step]}</h1><p>{step===0 && draft.song ? content.audioReadySubtitle : ["Upload the audio file you’ll use for the music video.","Upload a clear photo and choose the video format.","Describe the movement, emotion and camera style for your music video.","Review your creation before generating."][step]}</p></div>
        
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
              <strong>{photoUploadPhase==="uploading"?"Uploading your photo…":photoUploadPhase==="processing"?"Processing your photo…":"Drop a photo here or tap to browse"}</strong>
              {photoUploadPhase!=="idle"?<div className="sm-audio-upload-feedback" role="status" aria-live="polite">
                <span className="sm-audio-upload-filename" title={photoUploadingName}>{photoUploadingName}</span>
                <div className="sm-audio-upload-progress" role="progressbar" aria-label="Photo upload progress" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={photoUploadProgress===null?undefined:photoUploadProgress}>
                  <span style={{width:photoUploadProgress===null?"100%":photoUploadProgress+"%"}} className={photoUploadProgress===null||photoUploadPhase==="processing"?"is-indeterminate":""}/>
                </div>
                <span>{photoUploadPhase==="processing"?"Upload complete. Checking photo…":photoUploadProgress===null?"Sending file…":photoUploadProgress+"% uploaded"}</span>
              </div>:<span>JPG, PNG · up to 30 MB · clear front-facing portrait recommended</span>}
            </button>
          ) : (
            <>
              <div className="sm-photo-editor-stage">
                <span className="sm-photo-added"><Check size={13}/> Photo added</span>
                <button type="button" className="sm-photo-overlay-trash" disabled={busy} aria-label="Delete artist photo" title="Delete artist photo"
                  onClick={()=>{update({imageId:""});cropReset();setCropPending(false);}}><Trash2 size={18}/></button>
                <div className="sm-photo-crop-viewport" style={{aspectRatio:String(frameWidth/frameHeight)}}
                  onPointerDown={e=>{if(busy||!imageReady)return;cropDrag.current={x:e.clientX,y:e.clientY,startX:cropX,startY:cropY};e.currentTarget.setPointerCapture(e.pointerId);}}
                  onPointerMove={e=>{const drag=cropDrag.current;if(!drag||!e.currentTarget.hasPointerCapture(e.pointerId))return;
                    const rect=e.currentTarget.getBoundingClientRect();
                    if(cropExcessX>0.00001)setCropX(Math.max(0,Math.min(100,drag.startX-(e.clientX-drag.x)/Math.max(rect.width,1)/cropExcessX*100)));
                    if(cropExcessY>0.00001)setCropY(Math.max(0,Math.min(100,drag.startY-(e.clientY-drag.y)/Math.max(rect.height,1)/cropExcessY*100)));
                    if(cropExcessX>0.00001||cropExcessY>0.00001)setCropPending(true);}}
                  onPointerUp={e=>{cropDrag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
                  onPointerCancel={()=>{cropDrag.current=null;}}>
                  <img src={"/api/assets/"+encodeURIComponent(draft.imageId)} alt="Artist photo framing preview" draggable={false}
                    onLoad={e=>{setPhotoSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight});setImageReady(true);}}
                    style={{position:"absolute",left:"calc(50% + "+cropOffsetX+"%)",top:"calc(50% + "+cropOffsetY+"%)",
                      width:previewImageWidth+"%",height:previewImageHeight+"%",objectFit:"fill",
                      transform:"translate(-50%,-50%) rotate("+rotation+"deg) scaleX("+(flipped?-1:1)+")"}}/>
                  <div className="sm-photo-crop-grid" aria-hidden="true"/>
                  <span className="sm-photo-crop-corner tl" role="slider" tabIndex={0} aria-label="Crop TL handle"
                    aria-valuemin={customMode?40:100} aria-valuemax={customMode?250:300} aria-valuenow={customMode?Math.round(frameWidth/frameHeight*100):Math.round(cropScale*100)}
                    onPointerDown={e=>startCropHandle(e,"tl")} onPointerMove={moveCropHandle} onPointerUp={endCropHandle} onPointerCancel={endCropHandle}
                    onKeyDown={e=>{if(["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].includes(e.key)){e.preventDefault();if(customMode){const size=dimensionForRatio(frameWidth/frameHeight*(e.key==="ArrowUp"||e.key==="ArrowRight"?1.025:0.975));setCustomWidth(size.width);setCustomHeight(size.height);}else setCropScale(v=>Math.max(1,Math.min(3,v+(e.key==="ArrowUp"||e.key==="ArrowRight"?0.05:-0.05))));setCropPending(true);}}}/>
                  <span className="sm-photo-crop-corner tr" role="slider" tabIndex={0} aria-label="Crop TR handle"
                    aria-valuemin={customMode?40:100} aria-valuemax={customMode?250:300} aria-valuenow={customMode?Math.round(frameWidth/frameHeight*100):Math.round(cropScale*100)}
                    onPointerDown={e=>startCropHandle(e,"tr")} onPointerMove={moveCropHandle} onPointerUp={endCropHandle} onPointerCancel={endCropHandle}
                    onKeyDown={e=>{if(["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].includes(e.key)){e.preventDefault();if(customMode){const size=dimensionForRatio(frameWidth/frameHeight*(e.key==="ArrowUp"||e.key==="ArrowRight"?1.025:0.975));setCustomWidth(size.width);setCustomHeight(size.height);}else setCropScale(v=>Math.max(1,Math.min(3,v+(e.key==="ArrowUp"||e.key==="ArrowRight"?0.05:-0.05))));setCropPending(true);}}}/>
                  <span className="sm-photo-crop-corner bl" role="slider" tabIndex={0} aria-label="Crop BL handle"
                    aria-valuemin={customMode?40:100} aria-valuemax={customMode?250:300} aria-valuenow={customMode?Math.round(frameWidth/frameHeight*100):Math.round(cropScale*100)}
                    onPointerDown={e=>startCropHandle(e,"bl")} onPointerMove={moveCropHandle} onPointerUp={endCropHandle} onPointerCancel={endCropHandle}
                    onKeyDown={e=>{if(["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].includes(e.key)){e.preventDefault();if(customMode){const size=dimensionForRatio(frameWidth/frameHeight*(e.key==="ArrowUp"||e.key==="ArrowRight"?1.025:0.975));setCustomWidth(size.width);setCustomHeight(size.height);}else setCropScale(v=>Math.max(1,Math.min(3,v+(e.key==="ArrowUp"||e.key==="ArrowRight"?0.05:-0.05))));setCropPending(true);}}}/>
                  <span className="sm-photo-crop-corner br" role="slider" tabIndex={0} aria-label="Crop BR handle"
                    aria-valuemin={customMode?40:100} aria-valuemax={customMode?250:300} aria-valuenow={customMode?Math.round(frameWidth/frameHeight*100):Math.round(cropScale*100)}
                    onPointerDown={e=>startCropHandle(e,"br")} onPointerMove={moveCropHandle} onPointerUp={endCropHandle} onPointerCancel={endCropHandle}
                    onKeyDown={e=>{if(["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"].includes(e.key)){e.preventDefault();if(customMode){const size=dimensionForRatio(frameWidth/frameHeight*(e.key==="ArrowUp"||e.key==="ArrowRight"?1.025:0.975));setCustomWidth(size.width);setCustomHeight(size.height);}else setCropScale(v=>Math.max(1,Math.min(3,v+(e.key==="ArrowUp"||e.key==="ArrowRight"?0.05:-0.05))));setCropPending(true);}}}/>
                </div>
              </div>
            </>
          )}
          <div className="sm-photo-editor-tools sm-photo-one-row" role="toolbar" aria-label="Photo format and editing tools">
            <button type="button" aria-pressed={!customMode&&draft.outputFormat==="9:16"} className={!customMode&&draft.outputFormat==="9:16"?"is-selected":""}
              onClick={()=>{update({formatMode:"9:16",outputFormat:"9:16"});if(draft.imageId)setCropPending(true);}}><Smartphone size={16}/><span>9:16</span></button>
            <button type="button" aria-pressed={!customMode&&draft.outputFormat==="16:9"} className={!customMode&&draft.outputFormat==="16:9"?"is-selected":""}
              onClick={()=>{update({formatMode:"16:9",outputFormat:"16:9"});if(draft.imageId)setCropPending(true);}}><Monitor size={16}/><span>16:9</span></button>
            <button type="button" aria-pressed={customMode} className={customMode?"is-selected":""}
              onClick={()=>{setCustomWidth(draft.outputFormat==="9:16"?720:1280);setCustomHeight(draft.outputFormat==="9:16"?1280:720);setCropScale(1);setLockRatio(false);update({formatMode:"auto"});if(draft.imageId)setCropPending(true);}}><Crop size={16}/><span>Crop</span></button>
            <button type="button" disabled={!draft.imageId||busy} onClick={()=>{setRotation(v=>(v+90)%360);setCropPending(true);}}><RotateCw size={16}/><span>Rotate</span></button>
            <button type="button" disabled={!draft.imageId||busy} onClick={()=>{setFlipped(v=>!v);setCropPending(true);}}><FlipHorizontal2 size={16}/><span>Flip</span></button>
          </div>
          <div className="sm-photo-settings-row">
          <div className="sm-photo-formats" role="group" aria-label="Photo format dimensions">
            <div className="sm-photo-dimension-bar" role="group" aria-label="Image dimensions">
              <label>W <input type="number" min="256" max="4096" step="1" aria-label="Image width in pixels" value={frameWidth}
                readOnly={!customMode} onChange={e=>setCustomDimension("width",Number(e.target.value))}/><span>px</span></label>
              <button type="button" className="sm-photo-lock" disabled={!customMode} aria-label={lockRatio?"Unlock aspect ratio":"Lock aspect ratio"} onClick={()=>setLockRatio(v=>!v)}>
                {lockRatio?<LockKeyhole size={16}/>:<UnlockKeyhole size={16}/>}
              </button>
              <label>H <input type="number" min="256" max="4096" step="1" aria-label="Image height in pixels" value={frameHeight}
                readOnly={!customMode} onChange={e=>setCustomDimension("height",Number(e.target.value))}/><span>px</span></label>
            </div>
            {!frameValid&&<span role="alert" className="sm-photo-size-error">Width and height must be 256–4096 px, up to 16 megapixels.</span>}
          </div>
          {draft.imageId&&<div className="sm-photo-editor-bottom">
            <button type="button" className="sm-photo-reset" disabled={busy} onClick={()=>{cropReset();if(customMode){setCustomWidth(draft.outputFormat==="9:16"?720:1280);setCustomHeight(draft.outputFormat==="9:16"?1280:720);}setCropPending(true);}}>Reset</button>
            <button type="button" className="sm-photo-save" disabled={busy||!cropPending||!frameValid||!imageReady} onClick={()=>void applyPhotoFraming()}>{busy?"Saving…":"Apply"}</button>
          </div>}
          </div>
          <p className="sm-photo-step-tip"><ShieldCheck size={17}/> For best results, use a sharp, well-lit photo with the full face and mouth clearly visible. Avoid distant shots.</p>
        </section>}
        {step===2&&<section className="sm-performance-prompt-step sm-performance-redesign" aria-label="Performance prompt">
          <div className="sm-performance-editor">
            <label className="sr-only" htmlFor="flow-performance-prompt">Describe your artist's movement, emotion, and camera style</label>
            <textarea ref={performanceInput} id="flow-performance-prompt" className="sm-performance-textarea" maxLength={500} rows={4}
              placeholder="Singing passionately on stage, natural hand movements, strong eye contact with the camera, energetic and emotional."
              value={draft.customPrompt}
              onChange={e=>update({customPrompt:e.target.value,performance:e.target.value.trim()?"Custom":"Natural"})}/>
            <div className="sm-performance-editor-footer">
              <span><Sparkles size={17}/> AI Prompt</span>
              <span className="sm-performance-counter" aria-live="polite">{draft.customPrompt.length} / 500</span>
            </div>
          </div>
          <div className="sm-performance-ideas">
            <h2>Quick ideas</h2>
            <div className="sm-performance-chips" role="group" aria-label="Add performance ideas">
              {([
                {label:"On stage",prompt:"Performing live on stage under atmospheric concert lights.",icon:Clapperboard},
                {label:"Emotional",prompt:"Expressive eyes, heartfelt emotion, and natural hand gestures.",icon:Heart},
                {label:"Close-up",prompt:"Intimate close-up camera framing with steady eye contact.",icon:Video},
                {label:"Slow push-in",prompt:"A gentle cinematic camera push-in towards the singer.",icon:Camera},
                {label:"Energetic",prompt:"Confident, energetic singing with subtle rhythmic movements.",icon:Sparkles},
              ] as const).map(idea=><button type="button" key={idea.label} onClick={()=>{
                  const current=draft.customPrompt.trim();
                  if(current.toLowerCase().includes(idea.prompt.toLowerCase()))return;
                  const addition=current?(current.endsWith(".")?" ":"; "):"";
                  const result=current+addition+idea.prompt;
                  if(result.length>500){setError("Your prompt can contain up to 500 characters.");return;}
                  update({customPrompt:result,performance:"Custom"});
                  performanceInput.current?.focus();
                }}>
                  <idea.icon size={19}/><span>{idea.label}</span>
                </button>)}
            </div>
          </div>
          {advancedPerformanceToolsEnabled && <details className="sm-performance-advanced">
            <summary><ChevronDown size={16}/> Advanced: timeline and camera movements</summary>
            <div className="sm-performance-advanced-content">
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
            </div>
          </details>}
          <p className="sm-performance-tip"><ShieldCheck size={17}/> For best results, describe natural movements, clear emotions and simple camera directions.</p>
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
          {step<3&&<button type="button" className="sm-studio-next" disabled={busy||(step===0&&!audioValid)||(step===1&&(!draft.imageId||cropPending||!frameValid))} onClick={()=>setStep(x=>Math.min(3,x+1))}>Continue <ArrowRight size={19}/></button>}
          {step===3&&<button type="button" className="sm-studio-next" disabled={!available} onClick={()=>setConfirm(true)}>Generate Video <ArrowRight size={19}/></button>}
        </nav>
        {error && <p className="flow-error" role="alert">{error} {error.includes("3 guest drafts") && <Link href="/login">Log in</Link>}</p>}
        <div className="sm-studio-scroll-spacer" aria-hidden="true" />
      </main>
      {confirm && selection && <GenerationDialog key={JSON.stringify(selection)} selection={selection} requestKey={projectKey} artistName={draft.artistName} projectName={projectName} songName={draft.song?.name || "Audio"} onClose={()=>setConfirm(false)}/>}
    </div>
  );
}
