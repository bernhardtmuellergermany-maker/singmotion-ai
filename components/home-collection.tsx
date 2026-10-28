"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MoreVertical, Plus, UserRound, Trash2, Pencil, Download, Copy } from "lucide-react";
import { api, ensureSession } from "@/lib/client";
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
        <Link href="/" className="home-gallery-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link>
        <Link href="/settings" className="home-gallery-account" aria-label="Account settings"><UserRound size={21} /></Link>
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
        ) : <div className="home-gallery-empty-art"><div className="home-gallery-ghost ghost-left" /><div className="home-gallery-ghost ghost-right" /><CreateTile /><p>Your music videos will appear here.</p></div>}
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
  return <Link href="/studio?new=1" className="home-gallery-create">
    <span className="home-gallery-plus"><Plus size={38} strokeWidth={1.7} /></span>
    <strong>Create Project</strong>
    <span>Create a music video</span>
    <span className="sr-only">Open the studio</span>
  </Link>;
}
