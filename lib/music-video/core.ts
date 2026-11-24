import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {dataDir} from "@/lib/db";
import {validSongRange,validSongPlacement,MAX_TIMELINE_MS} from "./song-range.ts";

export type Track = 1 | 2;
export type SourceKind = "uploaded" | "live" | "paid";
export type MediaKind = "lip-sync" | "ai-video" | "imported";
export type MusicClip = {
  id:string; assetId:string; track:Track; timelineStartMs:number;
  sourceInMs:number; sourceOutMs:number; syncLocked:boolean;
};
export type MusicAsset = {
  id:string; projectId:string; name:string; kind:MediaKind; sourceKind:SourceKind;
  sourceId:string|null; durationMs:number; sourceStartMs:number|null;
  sourceEndMs:number|null; createdAt:number;
};
export type MusicProject = {
  id:string; ownerId:string; name:string; songDurationMs:number; songStartMs:number; songEndMs:number; songPositionMs:number;
  revision:number; createdAt:number; updatedAt:number; aspectRatio:"16:9";
};
export class MusicError extends Error {
  constructor(message:string,readonly status=400){super(message);}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validId(value:string):boolean{return uuid.test(value);}
export function projectFolder(projectId:string):string{
  if(!validId(projectId))throw new MusicError("Invalid project.",404);
  return path.join(dataDir,"music-video",projectId);
}
let db:DatabaseSync|undefined;
function database():DatabaseSync{
  if(db)return db;
  mkdirSync(path.join(dataDir,"music-video"),{recursive:true,mode:0o700});
  const opened=new DatabaseSync(path.join(dataDir,"music-video.sqlite"));
  opened.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  opened.exec("CREATE TABLE IF NOT EXISTS music_projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, song_duration_ms INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  // Older projects default to the full original song. Serialize the additive migration.
  opened.exec("BEGIN IMMEDIATE");
  try{
    const columns=opened.prepare("PRAGMA table_info(music_projects)").all() as {name:string}[];
    if(!columns.some(c=>c.name==="song_start_ms"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_start_ms INTEGER NOT NULL DEFAULT 0");
    if(!columns.some(c=>c.name==="song_end_ms"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_end_ms INTEGER DEFAULT NULL");
    if(!columns.some(c=>c.name==="song_position_ms"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_position_ms INTEGER DEFAULT NULL");
    opened.exec("COMMIT");
  }catch(e){opened.exec("ROLLBACK");opened.close();throw e;}
  opened.exec("CREATE INDEX IF NOT EXISTS music_projects_owner ON music_projects(owner_id,updated_at)");
  opened.exec("CREATE TABLE IF NOT EXISTS music_assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES music_projects(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT, duration_ms INTEGER NOT NULL, source_start_ms INTEGER, source_end_ms INTEGER, created_at INTEGER NOT NULL)");
  opened.exec("CREATE INDEX IF NOT EXISTS music_assets_project ON music_assets(project_id)");
  opened.exec("CREATE TABLE IF NOT EXISTS music_clips (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES music_projects(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES music_assets(id), track INTEGER NOT NULL, timeline_start_ms INTEGER NOT NULL, source_in_ms INTEGER NOT NULL, source_out_ms INTEGER NOT NULL, sync_locked INTEGER NOT NULL)");
  opened.exec("CREATE INDEX IF NOT EXISTS music_clips_project ON music_clips(project_id)");
  opened.exec("PRAGMA foreign_keys=ON;");
  db=opened;
  return opened;
}
type ProjectRow={id:string;owner_id:string;name:string;song_duration_ms:number;song_start_ms:number;song_end_ms:number|null;song_position_ms:number|null;revision:number;created_at:number;updated_at:number};
type AssetRow={id:string;project_id:string;name:string;kind:MediaKind;source_kind:SourceKind;source_id:string|null;duration_ms:number;source_start_ms:number|null;source_end_ms:number|null;created_at:number};
type ClipRow={id:string;asset_id:string;track:Track;timeline_start_ms:number;source_in_ms:number;source_out_ms:number;sync_locked:number};
const mapProject=(r:ProjectRow):MusicProject=>({id:r.id,ownerId:r.owner_id,name:r.name,songDurationMs:r.song_duration_ms,songStartMs:r.song_start_ms,songEndMs:r.song_end_ms??r.song_duration_ms,songPositionMs:r.song_position_ms??r.song_start_ms,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at,aspectRatio:"16:9"});
const mapAsset=(r:AssetRow):MusicAsset=>({id:r.id,projectId:r.project_id,name:r.name,kind:r.kind,sourceKind:r.source_kind,sourceId:r.source_id,durationMs:r.duration_ms,sourceStartMs:r.source_start_ms,sourceEndMs:r.source_end_ms,createdAt:r.created_at});
const mapClip=(r:ClipRow):MusicClip=>({id:r.id,assetId:r.asset_id,track:r.track,timelineStartMs:r.timeline_start_ms,sourceInMs:r.source_in_ms,sourceOutMs:r.source_out_ms,syncLocked:!!r.sync_locked});
export function requireMusicProject(id:string,owner:string):MusicProject{
  if(!validId(id))throw new MusicError("Project not found.",404);
  const row=database().prepare("SELECT * FROM music_projects WHERE id=? AND owner_id=?").get(id,owner) as ProjectRow|undefined;
  if(!row)throw new MusicError("Project not found.",404);
  return mapProject(row);
}
export function listMusicProjects(owner:string):MusicProject[]{
  return (database().prepare("SELECT * FROM music_projects WHERE owner_id=? ORDER BY updated_at DESC").all(owner) as ProjectRow[]).map(mapProject);
}
export function newMusicProject(owner:string,name:string,durationMs:number):MusicProject{
  const title=validatedName(name);
  if(!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>3600000)throw new MusicError("Song duration must be between 1 second and 60 minutes.");
  const now=Date.now(),id=randomUUID();
  database().prepare("INSERT INTO music_projects (id,owner_id,name,song_duration_ms,revision,created_at,updated_at) VALUES (?,?,?,?,0,?,?)").run(id,owner,title,durationMs,now,now);
  return requireMusicProject(id,owner);
}
function validatedName(v:unknown):string{
  if(typeof v!=="string"||v.trim().length<1||v.trim().length>80||/[\x00-\x1f\x7f]/.test(v))throw new MusicError("Enter a name of up to 80 characters.");
  return v.trim();
}
export function musicDetail(id:string,owner:string){
  const project=requireMusicProject(id,owner),connection=database();
  const assets=(connection.prepare("SELECT * FROM music_assets WHERE project_id=? ORDER BY created_at DESC").all(id) as AssetRow[]).map(mapAsset);
  const clips=(connection.prepare("SELECT * FROM music_clips WHERE project_id=? ORDER BY track,timeline_start_ms").all(id) as ClipRow[]).map(mapClip);
  return {project,assets,clips};
}
export function renameMusicProject(id:string,owner:string,name:unknown){
  requireMusicProject(id,owner);
  database().prepare("UPDATE music_projects SET name=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_id=?").run(validatedName(name),Date.now(),id,owner);
  return requireMusicProject(id,owner);
}
export function removeMusicProject(id:string,owner:string){
  requireMusicProject(id,owner);
  const connection=database();
  connection.exec("BEGIN IMMEDIATE");
  try{
    connection.prepare("DELETE FROM music_clips WHERE project_id=?").run(id);
    connection.prepare("DELETE FROM music_assets WHERE project_id=?").run(id);
    connection.prepare("DELETE FROM music_projects WHERE id=? AND owner_id=?").run(id,owner);
    connection.exec("COMMIT");
  }catch(error){connection.exec("ROLLBACK");throw error;}
}
export function newMusicAsset(id:string,owner:string,value:{
  name:string;kind:MediaKind;sourceKind:SourceKind;sourceId?:string|null;
  durationMs:number;sourceStartMs?:number|null;sourceEndMs?:number|null;
}):MusicAsset{
  requireMusicProject(id,owner);
  if(!Number.isSafeInteger(value.durationMs)||value.durationMs<100||value.durationMs>3600000)throw new MusicError("Invalid video duration.");
  if(!["lip-sync","ai-video","imported"].includes(value.kind)||!["uploaded","live","paid"].includes(value.sourceKind))throw new MusicError("Invalid asset type.");
  const aid=randomUUID(),now=Date.now();
  database().prepare("INSERT INTO music_assets VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    aid,id,validatedName(value.name),value.kind,value.sourceKind,value.sourceId||null,
    value.durationMs,value.sourceStartMs??null,value.sourceEndMs??null,now);
  database().prepare("UPDATE music_projects SET updated_at=?,revision=revision+1 WHERE id=? AND owner_id=?").run(now,id,owner);
  return (database().prepare("SELECT * FROM music_assets WHERE id=?").get(aid) as AssetRow|undefined) ? mapAsset(database().prepare("SELECT * FROM music_assets WHERE id=?").get(aid) as AssetRow) : (()=>{throw new MusicError("Asset unavailable.",500)})();
}
export function musicAsset(id:string,owner:string,assetId:string):MusicAsset{
  requireMusicProject(id,owner);
  if(!validId(assetId))throw new MusicError("Asset unavailable.",404);
  const row=database().prepare("SELECT * FROM music_assets WHERE id=? AND project_id=?").get(assetId,id) as AssetRow|undefined;
  if(!row)throw new MusicError("Asset unavailable.",404);
  return mapAsset(row);
}
export function removeMusicAsset(id:string,owner:string,assetId:string){
  musicAsset(id,owner,assetId);
  const active=database().prepare("SELECT 1 AS active FROM music_clips WHERE project_id=? AND asset_id=? LIMIT 1").get(id,assetId);
  if(active)throw new MusicError("Remove the clip from the timeline first.",409);
  database().prepare("DELETE FROM music_assets WHERE id=? AND project_id=?").run(assetId,id);
  database().prepare("UPDATE music_projects SET updated_at=?,revision=revision+1 WHERE id=?").run(Date.now(),id);
}
function integer(v:unknown,max:number){return typeof v==="number"&&Number.isSafeInteger(v)&&v>=0&&v<=max;}
export function validateMusicClips(clips:MusicClip[],assets:MusicAsset[],songMs:number,offset=0):MusicClip[]{
  if(!Array.isArray(clips)||clips.length>500)throw new MusicError("Too many timeline clips.");
  const byAsset=new Map(assets.map(a=>[a.id,a])),used=new Set<string>();
  const bounds:Record<Track,Array<[number,number]>>={1:[],2:[]};
  for(const c of clips){
    const a=byAsset.get(c?.assetId);
    if(!a||!validId(c.id)||used.has(c.id)|| (c.track!==1&&c.track!==2) ||
      !integer(c.timelineStartMs,songMs)||!integer(c.sourceInMs,a.durationMs)||
      !integer(c.sourceOutMs,a.durationMs)||c.sourceOutMs<=c.sourceInMs||
      typeof c.syncLocked!=="boolean")throw new MusicError("Invalid timeline clip.");
    used.add(c.id);
    const end=c.timelineStartMs+c.sourceOutMs-c.sourceInMs;
    if(end>songMs)throw new MusicError("Clip extends beyond the end of the song.",409);
    if(c.syncLocked){
      if(a.kind!=="lip-sync"||a.sourceStartMs===null||a.sourceEndMs===null ||
        c.timelineStartMs!==a.sourceStartMs+c.sourceInMs+offset||
        end>a.sourceEndMs+offset)throw new MusicError("Lip-sync position cannot change while Sync Lock is enabled.",409);
    }
    bounds[c.track].push([c.timelineStartMs,end]);
  }
  for(const track of [1,2] as const){
    bounds[track].sort((a,b)=>a[0]-b[0]);
    for(let i=1;i<bounds[track].length;i++)if(bounds[track][i][0]<bounds[track][i-1][1])
      throw new MusicError("Two clips cannot overlap on the same video track.",409);
  }
  return clips;
}
export function saveMusicClips(id:string,owner:string,revision:unknown,clips:MusicClip[],songStartMs?:unknown,songEndMs?:unknown,songPositionMs?:unknown){
  const project=requireMusicProject(id,owner),connection=database();
  if(!Number.isSafeInteger(revision)||revision!==project.revision)throw new MusicError("Project changed on another device. Reload to avoid overwriting edits.",409);
  const start=songStartMs===undefined&&songEndMs===undefined?project.songStartMs:songStartMs;
  const end=songStartMs===undefined&&songEndMs===undefined?project.songEndMs:songEndMs;
  if(!validSongRange(start,end,project.songDurationMs)||typeof end!=="number")
    throw new MusicError("Invalid song trim. Select at least 100 milliseconds within the original song.");
  const assets=musicDetail(id,owner).assets;
  const position=songPositionMs===undefined?Math.max(0,project.songPositionMs+start-project.songStartMs):songPositionMs;
  if(typeof position!=="number"||!validSongPlacement({startMs:start,endMs:end,positionMs:position},project.songDurationMs))
    throw new MusicError("Invalid song position.");
  const accepted=validateMusicClips(clips,assets,MAX_TIMELINE_MS,position-start);
  connection.exec("BEGIN IMMEDIATE");
  try{
    const changed=connection.prepare("UPDATE music_projects SET updated_at=?,revision=revision+1,song_start_ms=?,song_end_ms=?,song_position_ms=? WHERE id=? AND owner_id=? AND revision=?").run(Date.now(),start,end,position,id,owner,revision);
    if(changed.changes!==1)throw new MusicError("Project changed on another device. Reload to continue.",409);
    connection.prepare("DELETE FROM music_clips WHERE project_id=?").run(id);
    const add=connection.prepare("INSERT INTO music_clips VALUES (?,?,?,?,?,?,?,?)");
    for(const c of accepted)add.run(c.id,id,c.assetId,c.track,c.timelineStartMs,c.sourceInMs,c.sourceOutMs,c.syncLocked?1:0);
    connection.exec("COMMIT");
  }catch(e){connection.exec("ROLLBACK");throw e;}
  return musicDetail(id,owner);
}