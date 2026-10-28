"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, House, MoreVertical, Plus, UserRound } from "lucide-react";
import { api, ensureSession } from "@/lib/client";
import type { Job } from "@/lib/domain";
import type { StudioProject } from "@/lib/live/studio";

type Draft = { id: string; artistName: string; selection: { imageId?: string; start: number; end: number } };
type Tile = { id: string; name: string; href: string; imageId?: string; seconds: number; created: number; state?: string };
export function HomeCollection() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
            id: "live_" + p.id, name: p.artistName || "Untitled project",
            href: "/projects/live_" + encodeURIComponent(p.id),
            imageId: p.imageId, seconds: p.durationSeconds,
            created: p.createdAt, state: p.state,
          })),
          ...jobs.map(j => ({
            id: "job_" + j.id, name: j.artistName || "Untitled project",
            href: "/projects/" + encodeURIComponent(j.id),
            imageId: j.imageId, seconds: j.end - j.start,
            created: j.created, state: j.status,
          })),
          ...drafts.map(d => ({
            id: "draft_" + d.id, name: d.artistName || "Untitled project",
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
            {tiles.map(tile => <article className="home-gallery-item" key={tile.id}>
              <Link href={tile.href} className="home-gallery-cover">
                {tile.imageId ? <img src={`/api/assets/${encodeURIComponent(tile.imageId)}`} alt="" loading="lazy" /> : <div className="home-gallery-cover-placeholder" aria-hidden="true" />}
                <span className="home-gallery-duration">{Number.isFinite(tile.seconds) && tile.seconds > 0 ? `${Math.floor(tile.seconds / 60)}:${String(Math.floor(tile.seconds % 60)).padStart(2, "0")}` : "Draft"}</span>
                {tile.state && tile.state !== "completed" ? <span className="home-gallery-state">{tile.state}</span> : null}
              </Link>
              <div className="home-gallery-title-row">
                <Link href={tile.href} className="home-gallery-title">{tile.name}</Link>
                <Link href={tile.href} aria-label={`Open ${tile.name}`} className="home-gallery-more"><MoreVertical size={17} /></Link>
              </div>
              <p className="home-gallery-date">{tile.created ? new Date(tile.created).toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}) : "Saved draft"}</p>
            </article>)}
          </div>
        ) : <div className="home-gallery-empty-art"><div className="home-gallery-ghost ghost-left" /><div className="home-gallery-ghost ghost-right" /><CreateTile /><p>Your music videos will appear here.</p></div>}
      </main>
    </div>
  );
}
function CreateTile() {
  return <Link href="/studio" className="home-gallery-create">
    <span className="home-gallery-plus"><Plus size={38} strokeWidth={1.7} /></span>
    <strong>Create Project</strong>
    <span>Turn your songs into<br /> music videos with AI.</span>
    <span className="sr-only">Open the studio</span>
  </Link>;
}
