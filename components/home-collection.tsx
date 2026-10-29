"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MoreVertical, Plus, UserRound, Trash2, Pencil, Download, Copy, Music2 } from "lucide-react";
import { api, ensureSession, upload } from "@/lib/client";
import { validateFile, type Asset } from "@/lib/domain";
import type { Job } from "@/lib/domain";
import type { StudioProject } from "@/lib/live/studio";

type Draft = { id: string; artistName: string; selection: { imageId?: string; songId?: string; start: number; end: number } };
const cleanTitle = (name: string) => { const s = name.trim(); return !s || /^(?:[a-f0-9]{8}-[a-f0-9-]{20,}|(?:live_|job_|draft_)[a-f0-9-]{8,})$/i.test(s) ? "Untitled Project" : s; };
type Tile = { id: string; name: string; href: string; imageId?: string; seconds: number; created: number; state?: string; videoUrl?: string };
export function HomeCollection() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [renames, setRenames] = useState<Record<string,string>>({});
  useEffect(() => { try { setRenames(JSON.parse(localStorage.getItem("sm-gallery-labels") || "{}")); } catch {} }, []);
  const rename = (tile: Tile) => { const next = window.prompt("Project display name", renames[tile.id] || tile.name); if (next === null) return; const value = next.trim().slice(0,80) || "Untitled Project"; setRenames(old => { const updated={...old,[tile.id]:value}; localStorage.setItem("sm-gallery-labels",JSON.stringify(updated)); return updated; }); };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await ensureSession();
        const responses = await Promise.allSettled([
          api<Job[]>("jobs"),
          api<{ projects: StudioProject[] }>("studio-live"),
          api<Draft[]>("studio-drafts"),
        ]);
        if (!active) return;
        const jobs = responses[0].status === "fulfilled" ? responses[0].value : [];
        const live = responses[1].status === "fulfilled" ? responses[1].value.projects || [] : [];
        const drafts = responses[2].status === "fulfilled" ? responses[2].value : [];
        // Every source is already restricted to the private media session on the server.
        // Never display public examples or fabricate content in the user's collection.
        const items: Tile[] = [
          ...live.map(p => ({
            id: "live_" + p.id, name: cleanTitle(p.artistName || ""),
            href: "/projects/live_" + encodeURIComponent(p.id),
            imageId: p.imageId, seconds: p.durationSeconds,
            created: p.createdAt, state: p.state,
            videoUrl: p.outputReady ? `/api/studio-live?id=${encodeURIComponent(p.id)}&video=1` : undefined,
          })),
          ...jobs.map(j => ({
            id: "job_" + j.id, name: cleanTitle(j.artistName || ""),
            href: "/projects/" + encodeURIComponent(j.id),
            imageId: j.imageId, seconds: j.end - j.start,
            created: j.created, state: j.status,
            videoUrl: j.status === "completed" && j.outputId ? `/api/assets/${encodeURIComponent(j.outputId)}` : undefined,
          })),
          ...drafts.filter(d => d.selection.songId && d.selection.imageId).map(d => ({
            id: "draft_" + d.id, name: cleanTitle(d.artistName || ""),
            href: "/studio?draft=" + encodeURIComponent(d.id),
            imageId: d.selection.imageId,
            seconds: d.selection.end - d.selection.start,
            created: 0, state: "draft",
          })),
        ];
        setTiles(items.sort((a, b) => b.created - a.created));
        if (responses.every(x => x.status === "rejected")) setError("Your private projects could not be loaded. Refresh to try again.");
      } catch {
        if (active) setError("Your private workspace could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);
  return (
    <div className="home-gallery">
      <header className="home-gallery-header">
        <Link href="/" className="home-gallery-wordmark sm-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link>
        <div className="sm-header-actions"><GlobalMenu /><Link href="/login" className="home-gallery-account" aria-label="Login" title="Login"><UserRound size={21} /></Link></div>
      </header>
      <main id="content" className={loading || !tiles.length ? "home-gallery-empty" : "home-gallery-content"}>
        {error && <p className="home-gallery-error" role="alert">{error}</p>}
        {loading ? <p className="home-gallery-loading">Loading your projects…</p> : tiles.length ? (
          <div className="home-gallery-grid">
            <CreateTile />
            {tiles.map(tile => <GalleryTile key={tile.id} tile={{...tile,name:renames[tile.id] || tile.name}} deleting={deleting === tile.id} onRename={() => rename(tile)} onDelete={async () => {
              if (!window.confirm(`Permanently delete "${tile.name}"? This cannot be undone. Active provider tasks cannot be deleted.`)) return;
              setDeleting(tile.id); setError("");
              try {
                if (tile.id.startsWith("live_")) {
                  await api("studio-live", {method:"POST",body:JSON.stringify({action:"delete",id:tile.id.slice(5),confirmation:`DELETE ${tile.id.slice(5)}`})});
                } else if (tile.id.startsWith("job_")) {
                  await api(`jobs/${encodeURIComponent(tile.id.slice(4))}`,{method:"DELETE"});
                } else {
                  await api(`studio-drafts/${encodeURIComponent(tile.id.slice(6))}`,{method:"DELETE"});
                }
                setTiles(items => items.filter(item => item.id !== tile.id));
              } catch(e) {setError((e as Error).message);}
              finally {setDeleting(null);}
            }} />)}
          </div>
        ) : <div className="home-gallery-empty-art"><div className="home-gallery-ghost ghost-left" /><div className="home-gallery-ghost ghost-right" /><CreateTile /></div>}
      </main>
    </div>
  );
}
function GalleryTile({tile,deleting,onDelete,onRename}:{tile:Tile;deleting:boolean;onDelete:()=>void;onRename:()=>void}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing,setPlaying] = useState(false);
  const play=()=>{if(!video.current || !window.matchMedia("(hover: hover)").matches)return;video.current.muted=true;video.current.currentTime=0;void video.current.play().then(()=>setPlaying(true)).catch(()=>{});};
  const pause=()=>{video.current?.pause();setPlaying(false);};
  return <article className="home-gallery-item">
    <div className="home-gallery-cover" onMouseEnter={play} onMouseLeave={pause}>
      <Link href={tile.href} className="home-gallery-cover-link" aria-label={`Open ${tile.name}`}>
        {tile.imageId ? <img src={`/api/assets/${encodeURIComponent(tile.imageId)}`} alt="" loading="lazy" /> : <div className="home-gallery-cover-placeholder" />}
        {tile.videoUrl && <video ref={video} src={tile.videoUrl} muted playsInline preload="none" loop className={playing?"home-gallery-video playing":"home-gallery-video"} onEnded={()=>setPlaying(false)}/>}
      </Link>
      <span className="home-gallery-duration">{Number.isFinite(tile.seconds) && tile.seconds>0 ? `${Math.floor(tile.seconds/60)}:${String(Math.floor(tile.seconds%60)).padStart(2,"0")}` : "Draft"}</span>
      {tile.state && tile.state !== "completed" && <span className="home-gallery-state">{tile.state}</span>}
    </div>
    <div className="home-gallery-title-row">
      <Link href={tile.href} className="home-gallery-title" title={tile.name}>{tile.name}</Link>
      <details className="home-gallery-options"><summary aria-label={`Options for ${tile.name}`}><MoreVertical size={18}/></summary>
        <div className="home-gallery-options-list"><button type="button" onClick={onRename}><Pencil size={15}/> Rename</button><button type="button" onClick={()=>window.location.assign(tile.href)}><Copy size={15}/> Open to duplicate</button>{tile.videoUrl && <a href={tile.videoUrl + (tile.id.startsWith("live_") ? "&download=1" : "")} download><Download size={15}/> Download</a>}<button type="button" disabled={deleting} onClick={onDelete}><Trash2 size={15}/> {deleting?"Deleting…":"Delete"}</button></div>
      </details>
    </div>
    <p className="home-gallery-date">{tile.created?new Date(tile.created).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"Saved draft"}</p>
  </article>;
}
function CreateTile() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function selectAudio(file?: File) {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    try {
      validateFile(file.name, file.size, "audio");
      await ensureSession();
      const asset = await upload(file, "audio") as Asset;
      // One-time handoff into a fresh Studio project; never reuse the prior draft.
      sessionStorage.setItem("singmotion-home-audio-handoff", JSON.stringify(asset));
      window.location.assign("/studio?new=1&audio=1");
    } catch (e) {
      setError((e as Error).message || "Audio upload failed. Please try again.");
      setUploading(false);
    }
  }
  return <div className="home-gallery-upload-wrap">
    <label className={uploading ? "home-gallery-create home-gallery-upload is-uploading" : "home-gallery-create home-gallery-upload"}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); void selectAudio(e.dataTransfer.files?.[0]); }}>
      <input type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" disabled={uploading}
        aria-label="Upload your song" onChange={e => { void selectAudio(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      <span className="home-gallery-plus"><Music2 size={30} strokeWidth={1.7} /></span>
      <strong>{uploading ? "Uploading your song…" : "Upload your song"}</strong>
      <span>Drag & drop or click to choose audio</span>
      <small>MP3, WAV, M4A · up to 50 MB</small>
      <span className="sr-only">Start a new video by uploading audio</span>
    </label>
    {error && <p className="home-gallery-upload-error" role="alert">{error}</p>}
  </div>;
}

export function GlobalMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current) menu.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, []);
  return <details ref={menu} className="sm-global-menu">
    <summary aria-label="More options" title="More options"><MoreVertical size={19}/></summary>
    <nav className="sm-global-menu-list" aria-label="More options">
      <Link href="/help" onClick={() => { if (menu.current) menu.current.open = false; }}>Help</Link>
      <Link href="/legal" onClick={() => { if (menu.current) menu.current.open = false; }}>Legals</Link>
    </nav>
  </details>;
}
