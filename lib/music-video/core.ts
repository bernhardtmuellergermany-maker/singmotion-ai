import {reserveProjectOperation,type OperationKind} from "./capacity.ts";
import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import path from "node:path";
import type {ProjectCloudRecord,SongSlot} from "./project-r2";
import {dataDir} from "@/lib/db";
import {validSongRange,validSongPlacement,MAX_TIMELINE_MS,validSongParts,firstVisibleVideo,type SongPlacement,type SongRange} from "./song-range.ts";

export type Track = 1 | 2;
export type AudioTrack = Track | "song";
export type TrackMutes = Record<AudioTrack,boolean>;
export type SourceKind = "uploaded" | "live" | "paid";
export type MediaKind = "lip-sync" | "ai-video" | "imported";
export type MediaRole = "lip-sync" | "b-roll";
export type MusicClip = {
  id:string; assetId:string; track:Track; timelineStartMs:number;
  sourceInMs:number; sourceOutMs:number; syncLocked:boolean; positionLocked?:boolean; showVideoName?:boolean;
};
export type MusicAsset = {
  id:string; projectId:string; name:string; kind:MediaKind; role:MediaRole; sourceKind:SourceKind;
  sourceId:string|null; durationMs:number; sourceStartMs:number|null;
  sourceEndMs:number|null; createdAt:number;
};
export type ProjectAspectRatio = "auto" | "16:9" | "9:16";
function validatedAspectRatio(value:unknown):ProjectAspectRatio{
 if(value!=="auto"&&value!=="16:9"&&value!=="9:16")throw new MusicError("Choose Auto, 16:9 or 9:16.");
 return value;
}
export type SongRestore={range:SongPlacement;parts:SongRange[]|null;durationMs:number;clips:MusicClip[]};
export type MusicProject = {
  id:string; ownerId:string; name:string; songName:string|null; songRemoved?:boolean; songVersion?:string|null; songRestore?:SongRestore|null; songDurationMs:number; songStartMs:number; songEndMs:number; songPositionMs:number; songParts:SongRange[]|null; trackMutes:TrackMutes;
  revision:number; createdAt:number; updatedAt:number; aspectRatio:ProjectAspectRatio;
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
    if(!columns.some(c=>c.name==="song_restore_json"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_restore_json TEXT DEFAULT NULL");
    if(!columns.some(c=>c.name==="song_removed"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_removed INTEGER NOT NULL DEFAULT 0");
    if(!columns.some(c=>c.name==="song_version"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_version TEXT DEFAULT NULL");
    if(!columns.some(c=>c.name==="song_name"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_name TEXT DEFAULT NULL");
    if(!columns.some(c=>c.name==="song_start_ms"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_start_ms INTEGER NOT NULL DEFAULT 0");
    if(!columns.some(c=>c.name==="song_end_ms"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_end_ms INTEGER DEFAULT NULL");
    if(!columns.some(c=>c.name==="song_position_ms"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_position_ms INTEGER DEFAULT NULL");
    if(!columns.some(c=>c.name==="song_parts_json"))opened.exec("ALTER TABLE music_projects ADD COLUMN song_parts_json TEXT DEFAULT NULL");
    if(!columns.some(c=>c.name==="track_mute_mask"))opened.exec("ALTER TABLE music_projects ADD COLUMN track_mute_mask INTEGER NOT NULL DEFAULT 3");
    if(!columns.some(c=>c.name==="aspect_ratio"))opened.exec("ALTER TABLE music_projects ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT 'auto'");
    opened.exec("COMMIT");
  }catch(e){opened.exec("ROLLBACK");opened.close();throw e;}
  opened.exec("CREATE INDEX IF NOT EXISTS music_projects_owner ON music_projects(owner_id,updated_at)");
  opened.exec("CREATE TABLE IF NOT EXISTS music_assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES music_projects(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT, duration_ms INTEGER NOT NULL, source_start_ms INTEGER, source_end_ms INTEGER, created_at INTEGER NOT NULL)");
  opened.exec("BEGIN IMMEDIATE");
  try{
    const columns=opened.prepare("PRAGMA table_info(music_assets)").all() as {name:string}[];
    if(!columns.some(c=>c.name==="role"))opened.exec("ALTER TABLE music_assets ADD COLUMN role TEXT DEFAULT NULL");
    opened.exec("COMMIT");
  }catch(e){opened.exec("ROLLBACK");opened.close();throw e;}
  opened.exec("CREATE INDEX IF NOT EXISTS music_assets_project ON music_assets(project_id)");
  opened.exec("CREATE TABLE IF NOT EXISTS music_clips (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES music_projects(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES music_assets(id), track INTEGER NOT NULL, timeline_start_ms INTEGER NOT NULL, source_in_ms INTEGER NOT NULL, source_out_ms INTEGER NOT NULL, sync_locked INTEGER NOT NULL)");
  opened.exec("BEGIN IMMEDIATE");
  try{
    const columns=opened.prepare("PRAGMA table_info(music_clips)").all() as {name:string}[];
    if(!columns.some(c=>c.name==="position_locked"))opened.exec("ALTER TABLE music_clips ADD COLUMN position_locked INTEGER NOT NULL DEFAULT 0");
    if(!columns.some(c=>c.name==="show_video_name"))opened.exec("ALTER TABLE music_clips ADD COLUMN show_video_name INTEGER NOT NULL DEFAULT 0");
    opened.exec("COMMIT");
  }catch(e){opened.exec("ROLLBACK");opened.close();throw e;}
  opened.exec("CREATE INDEX IF NOT EXISTS music_clips_project ON music_clips(project_id)");
  // Retain pending-delete manifests until R2 confirms deletion; no cascading loss of object keys.
  opened.exec("CREATE TABLE IF NOT EXISTS music_asset_cloud (asset_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, owner_id TEXT NOT NULL, object_key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, pending_delete INTEGER NOT NULL DEFAULT 0)");
  opened.exec("CREATE INDEX IF NOT EXISTS music_asset_cloud_owner ON music_asset_cloud(owner_id,pending_delete)");
  opened.exec("PRAGMA foreign_keys=ON;");
  db=opened;
  return opened;
}
type ProjectRow={id:string;owner_id:string;name:string;song_name:string|null;song_removed:number;song_version:string|null;song_restore_json:string|null;song_duration_ms:number;song_start_ms:number;song_end_ms:number|null;song_position_ms:number|null;song_parts_json:string|null;track_mute_mask:number;aspect_ratio:ProjectAspectRatio;revision:number;created_at:number;updated_at:number};
type AssetRow={id:string;project_id:string;name:string;kind:MediaKind;role:MediaRole|null;source_kind:SourceKind;source_id:string|null;duration_ms:number;source_start_ms:number|null;source_end_ms:number|null;created_at:number};
type ClipRow={id:string;asset_id:string;track:Track;timeline_start_ms:number;source_in_ms:number;source_out_ms:number;sync_locked:number;position_locked:number;show_video_name:number};
const mapProject=(r:ProjectRow):MusicProject=>({id:r.id,ownerId:r.owner_id,name:r.name,songName:r.song_name??null,songRemoved:!!r.song_removed,songVersion:r.song_version??null,songRestore:r.song_restore_json?JSON.parse(r.song_restore_json) as SongRestore:null,songDurationMs:r.song_duration_ms,songStartMs:r.song_start_ms,songEndMs:r.song_end_ms??r.song_duration_ms,songPositionMs:r.song_position_ms??r.song_start_ms,songParts:r.song_parts_json?JSON.parse(r.song_parts_json) as SongRange[]:null,trackMutes:{1:!!(r.track_mute_mask&1),2:!!(r.track_mute_mask&2),song:!!(r.track_mute_mask&4)},revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at,aspectRatio:r.aspect_ratio==="9:16"||r.aspect_ratio==="16:9"?r.aspect_ratio:"auto"});
const mapAsset=(r:AssetRow):MusicAsset=>({id:r.id,projectId:r.project_id,name:r.name,kind:r.kind,role:r.role??(r.kind==="lip-sync"?"lip-sync":"b-roll"),sourceKind:r.source_kind,sourceId:r.source_id,durationMs:r.duration_ms,sourceStartMs:r.source_start_ms,sourceEndMs:r.source_end_ms,createdAt:r.created_at});
const mapClip=(r:ClipRow):MusicClip=>({id:r.id,assetId:r.asset_id,track:r.track,timelineStartMs:r.timeline_start_ms,sourceInMs:r.source_in_ms,sourceOutMs:r.source_out_ms,syncLocked:!!r.sync_locked,positionLocked:!!r.position_locked,showVideoName:!!r.show_video_name});
export function requireMusicProject(id:string,owner:string):MusicProject{
  if(!validId(id))throw new MusicError("Project not found.",404);
  const row=database().prepare("SELECT * FROM music_projects WHERE id=? AND owner_id=?").get(id,owner) as ProjectRow|undefined;
  if(!row)throw new MusicError("Project not found.",404);
  return mapProject(row);
}
export type MusicProjectSummary=MusicProject&{thumbnailAssetId:string|null};
export function listMusicProjects(owner:string):MusicProjectSummary[]{
  const connection=database();
  const rows=connection.prepare("SELECT * FROM music_projects WHERE owner_id=? ORDER BY updated_at DESC").all(owner) as ProjectRow[];
  const clips=connection.prepare("SELECT * FROM music_clips WHERE project_id=?");
  return rows.map(row=>({...mapProject(row),thumbnailAssetId:firstVisibleVideo((clips.all(row.id) as ClipRow[]).map(mapClip))?.assetId??null}));
}
export function newMusicProject(owner:string,name:string,durationMs:number,aspectRatio:unknown="auto",songName?:string):MusicProject{
  const title=validatedName(name);
  if(!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>3600000)throw new MusicError("Song duration must be between 1 second and 60 minutes.");
  const now=Date.now(),id=randomUUID();
  database().prepare("INSERT INTO music_projects (id,owner_id,name,song_duration_ms,revision,created_at,updated_at,aspect_ratio,song_name) VALUES (?,?,?,?,0,?,?,?,?)").run(id,owner,title,durationMs,now,now,validatedAspectRatio(aspectRatio),songName?validatedSongName(songName):null);
  return requireMusicProject(id,owner);
}
function validatedSongName(v:unknown):string{
 if(typeof v!=="string"||!v.trim()||v.trim().length>180||/[\x00-\x1f\x7f]/.test(v))throw new MusicError("Enter a song name of up to 180 characters.");
 return v.trim();
}
export function renameMusicSong(id:string,owner:string,name:unknown){
 requireMusicProject(id,owner);
 database().prepare("UPDATE music_projects SET song_name=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_id=?").run(validatedSongName(name),Date.now(),id,owner);
 return requireMusicProject(id,owner);
}
export function fillMusicSongName(id:string,owner:string,name:string){
 database().prepare("UPDATE music_projects SET song_name=? WHERE id=? AND owner_id=? AND song_name IS NULL").run(validatedSongName(name),id,owner);
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
    connection.prepare("UPDATE music_asset_cloud SET pending_delete=1 WHERE project_id=? AND owner_id=?").run(id,owner);
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
  database().prepare("INSERT INTO music_assets (id,project_id,name,kind,source_kind,source_id,duration_ms,source_start_ms,source_end_ms,created_at,role) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    aid,id,validatedName(value.name),value.kind,value.sourceKind,value.sourceId||null,
    value.durationMs,value.sourceStartMs??null,value.sourceEndMs??null,now,value.kind==="lip-sync"?"lip-sync":"b-roll");
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
/** Role belongs to this project; source provenance and exact original times are immutable. */
export function setMusicAssetRole(id:string,owner:string,assetId:string,role:unknown,revision:unknown){
  if(role!=="lip-sync"&&role!=="b-roll")throw new MusicError("Unknown video role.");
  const project=requireMusicProject(id,owner),asset=musicAsset(id,owner,assetId),connection=database();
  if(!Number.isSafeInteger(revision)||revision!==project.revision)throw new MusicError("Project changed on another device. Reload to continue.",409);
  if(asset.role===role)return musicDetail(id,owner);
  connection.exec("BEGIN IMMEDIATE");
  try{
    const changed=connection.prepare("UPDATE music_projects SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?").run(Date.now(),id,owner,revision);
    if(changed.changes!==1)throw new MusicError("Project changed on another device. Reload to continue.",409);
    connection.prepare("UPDATE music_assets SET role=? WHERE id=? AND project_id=?").run(role,assetId,id);
    // B-roll is freely positioned; never move, delete, or trim existing timeline clips.
    if(role==="b-roll")connection.prepare("UPDATE music_clips SET sync_locked=0 WHERE project_id=? AND asset_id=?").run(id,assetId);
    connection.exec("COMMIT");
  }catch(e){connection.exec("ROLLBACK");throw e;}
  return musicDetail(id,owner);
}
/** User-supplied reference times for uploaded media only. No generation data is overwritten.
 * Invalidate old synchronization locks atomically, without moving any timeline clip. */
export function setUploadedAssetSourceTime(id:string,owner:string,assetId:string,start:unknown,end:unknown,revision:unknown){
  const project=requireMusicProject(id,owner),asset=musicAsset(id,owner,assetId),connection=database();
  if(asset.sourceKind!=="uploaded")throw new MusicError("Original generation source times cannot be changed.",409);
  if(!Number.isSafeInteger(revision)||revision!==project.revision)throw new MusicError("Project changed on another device. Reload to continue.",409);
  if(!validSongRange(start,end,MAX_TIMELINE_MS)||typeof end!=="number")throw new MusicError("Enter a valid source start and end at least 100 ms apart.");
  if(asset.sourceStartMs===start&&asset.sourceEndMs===end)return musicDetail(id,owner);
  connection.exec("BEGIN IMMEDIATE");
  try{
    const changed=connection.prepare("UPDATE music_projects SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?").run(Date.now(),id,owner,revision);
    if(changed.changes!==1)throw new MusicError("Project changed on another device. Reload to continue.",409);
    const saved=connection.prepare("UPDATE music_assets SET source_start_ms=?,source_end_ms=? WHERE id=? AND project_id=? AND source_kind='uploaded'").run(start,end,assetId,id);
    if(saved.changes!==1)throw new MusicError("Uploaded video unavailable.",404);
    connection.prepare("UPDATE music_clips SET sync_locked=0 WHERE project_id=? AND asset_id=?").run(id,assetId);
    connection.exec("COMMIT");
  }catch(e){connection.exec("ROLLBACK");throw e;}
  return musicDetail(id,owner);
}
/** A project alias only: never touch the originating video, its file, or other projects. */
export function renameMusicAsset(id:string,owner:string,assetId:string,name:unknown,revision:unknown){
  const title=validatedName(name),project=requireMusicProject(id,owner),asset=musicAsset(id,owner,assetId),connection=database();
  if(!Number.isSafeInteger(revision)||revision!==project.revision)throw new MusicError("Project changed on another device. Reload to continue.",409);
  if(asset.name===title)return musicDetail(id,owner);
  connection.exec("BEGIN IMMEDIATE");
  try{
    const changed=connection.prepare("UPDATE music_projects SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?").run(Date.now(),id,owner,revision);
    if(changed.changes!==1)throw new MusicError("Project changed on another device. Reload to continue.",409);
    const renamed=connection.prepare("UPDATE music_assets SET name=? WHERE id=? AND project_id=?").run(title,assetId,id);
    if(renamed.changes!==1)throw new MusicError("Asset unavailable.",404);
    connection.exec("COMMIT");
  }catch(e){connection.exec("ROLLBACK");throw e;}
  return musicDetail(id,owner);
}
export function removeMusicAsset(id:string,owner:string,assetId:string){
  musicAsset(id,owner,assetId);
  const active=database().prepare("SELECT 1 AS active FROM music_clips WHERE project_id=? AND asset_id=? LIMIT 1").get(id,assetId);
  if(active)throw new MusicError("Remove the clip from the timeline first.",409);
  const db=database();db.exec("BEGIN IMMEDIATE");
  try{
   db.prepare("UPDATE music_asset_cloud SET pending_delete=1 WHERE asset_id=? AND project_id=? AND owner_id=?").run(assetId,id,owner);
   db.prepare("DELETE FROM music_assets WHERE id=? AND project_id=?").run(assetId,id);
   db.prepare("UPDATE music_projects SET updated_at=?,revision=revision+1 WHERE id=?").run(Date.now(),id);
   db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e;}
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
      typeof c.syncLocked!=="boolean"||(c.positionLocked!==undefined&&typeof c.positionLocked!=="boolean")||(c.showVideoName!==undefined&&typeof c.showVideoName!=="boolean"))throw new MusicError("Invalid timeline clip.");
    used.add(c.id);
    const end=c.timelineStartMs+c.sourceOutMs-c.sourceInMs;
    if(end>songMs)throw new MusicError("Clip extends beyond the end of the song.",409);
    if(c.syncLocked){
      if(a.role!=="lip-sync"||a.sourceStartMs===null||a.sourceEndMs===null ||
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
export function saveMusicClips(id:string,owner:string,revision:unknown,clips:MusicClip[],songStartMs?:unknown,songEndMs?:unknown,songPositionMs?:unknown,songParts?:unknown,trackMutes?:unknown,aspectRatio?:unknown){
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
  const parts=songParts===undefined?project.songParts:songParts;
  if(parts!==null&&!validSongParts(parts,{startMs:start,endMs:end,positionMs:position}))throw new MusicError("Invalid song parts.");
  const mutes=trackMutes===undefined?project.trackMutes:trackMutes as TrackMutes;
  if(!mutes||typeof mutes!=="object"||typeof mutes[1]!=="boolean"||typeof mutes[2]!=="boolean"||typeof mutes.song!=="boolean")throw new MusicError("Invalid track mute settings.");
  const ratio=aspectRatio===undefined?project.aspectRatio:validatedAspectRatio(aspectRatio);
  const muteMask=(mutes[1]?1:0)|(mutes[2]?2:0)|(mutes.song?4:0);
  if(project.songRemoved&&clips.some(c=>c.syncLocked))throw new MusicError("Add a song before enabling Sync Lock.",409);
  const accepted=validateMusicClips(clips,assets,MAX_TIMELINE_MS,position-start);
  connection.exec("BEGIN IMMEDIATE");
  try{
    const changed=connection.prepare("UPDATE music_projects SET updated_at=?,revision=revision+1,song_start_ms=?,song_end_ms=?,song_position_ms=?,song_parts_json=?,track_mute_mask=?,aspect_ratio=? WHERE id=? AND owner_id=? AND revision=?").run(Date.now(),start,end,position,parts===null?null:JSON.stringify(parts),muteMask,ratio,id,owner,revision);
    if(changed.changes!==1)throw new MusicError("Project changed on another device. Reload to continue.",409);
    connection.prepare("DELETE FROM music_clips WHERE project_id=?").run(id);
    const add=connection.prepare("INSERT INTO music_clips (id,project_id,asset_id,track,timeline_start_ms,source_in_ms,source_out_ms,sync_locked,position_locked,show_video_name) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for(const c of accepted)add.run(c.id,id,c.assetId,c.track,c.timelineStartMs,c.sourceInMs,c.sourceOutMs,c.syncLocked?1:0,c.positionLocked?1:0,c.showVideoName?1:0);
    connection.exec("COMMIT");
  }catch(e){connection.exec("ROLLBACK");throw e;}
  return musicDetail(id,owner);
}
type CloudRow={asset_id:string;project_id:string;object_key:string;sha256:string;bytes:number};
const mapCloud=(r:CloudRow):ProjectCloudRecord=>({key:r.object_key,sha256:r.sha256,bytes:r.bytes});
export function projectCloudRecord(id:string,owner:string,assetId:string):ProjectCloudRecord|null{
 musicAsset(id,owner,assetId);
 const row=database().prepare("SELECT * FROM music_asset_cloud WHERE project_id=? AND owner_id=? AND asset_id=? AND pending_delete=0").get(id,owner,assetId) as CloudRow|undefined;
 return row?mapCloud(row):null;
}
export function recordProjectCloud(id:string,owner:string,assetId:string,record:ProjectCloudRecord){
 const db=database();
 const inserted=db.prepare("INSERT INTO music_asset_cloud(asset_id,project_id,owner_id,object_key,sha256,bytes) SELECT a.id,a.project_id,p.owner_id,?,?,? FROM music_assets a JOIN music_projects p ON p.id=a.project_id WHERE a.id=? AND a.project_id=? AND p.owner_id=? AND a.source_kind='uploaded' ON CONFLICT(asset_id) DO NOTHING").run(record.key,record.sha256,record.bytes,assetId,id,owner);
 const current=projectCloudRecord(id,owner,assetId);
 if(!current||current.key!==record.key||current.sha256!==record.sha256||current.bytes!==record.bytes)throw Error("Projects cloud manifest conflict");
 return inserted.changes;
}
export function projectMigrationCandidates(owner:string){
 return (database().prepare("SELECT a.* FROM music_assets a JOIN music_projects p ON p.id=a.project_id LEFT JOIN music_asset_cloud c ON c.asset_id=a.id WHERE p.owner_id=? AND a.source_kind='uploaded' AND c.asset_id IS NULL ORDER BY a.created_at,a.id LIMIT 1").all(owner) as AssetRow[]).map(mapAsset);
}
export function pendingProjectCloudDeletes(owner:string){
 return (database().prepare("SELECT * FROM music_asset_cloud WHERE owner_id=? AND pending_delete=1 LIMIT 10").all(owner) as CloudRow[]).map(r=>({projectId:r.project_id,assetId:r.asset_id,record:mapCloud(r)}));
}
export function finishProjectCloudDelete(owner:string,assetId:string,key:string){
 database().prepare("DELETE FROM music_asset_cloud WHERE owner_id=? AND asset_id=? AND object_key=? AND pending_delete=1").run(owner,assetId,key);
}

/** Song manifests share the durable deletion queue; slot IDs are namespaced
 * by their project, never supplied by the browser. */
export function projectSongRecord(id:string,owner:string,slot:SongSlot):ProjectCloudRecord|null{
 const project=requireMusicProject(id,owner);
 if(project.songRemoved)return null;
 const row=database().prepare("SELECT * FROM music_asset_cloud WHERE project_id=? AND owner_id=? AND asset_id=? AND pending_delete=0").get(id,owner,id+":"+slot+(project.songVersion?":"+project.songVersion:"")) as CloudRow|undefined;
 return row?mapCloud(row):null;
}
export function recordProjectSong(id:string,owner:string,slot:SongSlot,record:ProjectCloudRecord){
 const db=database(),asset=id+":"+slot;
 db.prepare("INSERT INTO music_asset_cloud(asset_id,project_id,owner_id,object_key,sha256,bytes) SELECT ?,id,owner_id,?,?,? FROM music_projects WHERE id=? AND owner_id=? AND song_removed=0 AND song_version IS NULL ON CONFLICT(asset_id) DO NOTHING").run(asset,record.key,record.sha256,record.bytes,id,owner);
 const current=projectSongRecord(id,owner,slot);
 if(!current||current.key!==record.key||current.sha256!==record.sha256||current.bytes!==record.bytes)throw Error("Projects song cloud manifest conflict");
}
export function projectSongMigrationCandidate(owner:string){
 const row=database().prepare("SELECT p.id FROM music_projects p WHERE p.owner_id=? AND p.song_removed=0 AND p.song_version IS NULL AND (NOT EXISTS(SELECT 1 FROM music_asset_cloud c WHERE c.project_id=p.id AND c.owner_id=p.owner_id AND c.asset_id=p.id||':song.mp3' AND c.pending_delete=0) OR NOT EXISTS(SELECT 1 FROM music_asset_cloud c WHERE c.project_id=p.id AND c.owner_id=p.owner_id AND c.asset_id LIKE p.id||':song-original.%' AND c.pending_delete=0)) ORDER BY p.created_at,p.id LIMIT 1").get(owner) as {id:string}|undefined;
 return row?.id??null;
}

/** Remove only the song; video positions and position locks remain intact. */
export function detachProjectSong(id:string,owner:string,revision:unknown){
 const detail=musicDetail(id,owner),project=detail.project,db=database();
 if(project.songRemoved||!Number.isSafeInteger(revision)||revision!==project.revision)throw new MusicError("Project changed. Reload to continue.",409);
 db.exec("BEGIN IMMEDIATE");
 try{
  const roles=new Set(detail.assets.filter(a=>a.role==="lip-sync").map(a=>a.id));
  const snapshot:SongRestore={range:{startMs:project.songStartMs,endMs:project.songEndMs,positionMs:project.songPositionMs},parts:project.songParts,durationMs:project.songDurationMs,clips:detail.clips.filter(c=>roles.has(c.assetId))};
  const extent=db.prepare("SELECT MAX(timeline_start_ms+source_out_ms-source_in_ms) AS end_ms FROM music_clips WHERE project_id=?").get(id) as {end_ms:number|null};
  const duration=Math.max(10000,project.songDurationMs,project.songPositionMs+project.songEndMs-project.songStartMs,extent.end_ms??0);
  const changed=db.prepare("UPDATE music_projects SET song_removed=1,song_name=NULL,song_restore_json=?,song_duration_ms=?,song_start_ms=0,song_end_ms=?,song_position_ms=0,song_parts_json=NULL,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND song_removed=0").run(JSON.stringify(snapshot),duration,duration,Date.now(),id,owner,revision);
  if(changed.changes!==1)throw new MusicError("Project changed. Reload to continue.",409);
  db.prepare("UPDATE music_asset_cloud SET pending_delete=1 WHERE project_id=? AND owner_id=? AND asset_id LIKE ?").run(id,owner,id+":song%");
  db.prepare("UPDATE music_clips SET sync_locked=0 WHERE project_id=?").run(id);
  db.exec("COMMIT");
 }catch(e){db.exec("ROLLBACK");throw e;}
 return musicDetail(id,owner);
}
/** Each replacement has unique immutable cloud IDs, so an old deletion cannot delete it. */
export function attachProjectSong(id:string,owner:string,revision:unknown,version:string,name:string,duration:number,records:{slot:SongSlot;record:ProjectCloudRecord}[]){
 const project=requireMusicProject(id,owner),db=database();
 if(!project.songRemoved||!Number.isSafeInteger(revision)||revision!==project.revision)throw new MusicError("Project changed. Reload to continue.",409);
 if(!validId(version)||!validSongRange(0,duration,duration)||duration>MAX_TIMELINE_MS||records.length!==2||!records.some(r=>r.slot==="song.mp3")||!records.some(r=>r.slot.startsWith("song-original.")))throw new MusicError("Invalid replacement song.");
 db.exec("BEGIN IMMEDIATE");
 try{
  const previous=project.songRestore;
  // Preserve the old song clock offset if the new recording supports it.
  // Different-length replacements keep their full duration where possible.
  const priorRange=previous?{...previous.range,endMs:previous.range.endMs===previous.durationMs?duration:Math.min(previous.range.endMs,duration)}:null;
  const range=priorRange&&validSongPlacement(priorRange,duration)?priorRange:{startMs:0,endMs:duration,positionMs:0};
  const parts=previous&&range===priorRange&&previous.parts&&validSongParts(previous.parts,range)?previous.parts:null;
  const changed=db.prepare("UPDATE music_projects SET song_removed=0,song_version=?,song_name=?,song_duration_ms=?,song_start_ms=?,song_end_ms=?,song_position_ms=?,song_parts_json=?,track_mute_mask=track_mute_mask & 3,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND song_removed=1").run(version,validatedSongName(name),duration,range.startMs,range.endMs,range.positionMs,parts===null?null:JSON.stringify(parts),Date.now(),id,owner,revision);
  // Reapply only previously active locks whose exact original media mapping
  // still matches. Never move, trim or overwrite edits made while songless.
  const oldLocks=new Map(previous?.clips.filter(c=>c.syncLocked).map(c=>[c.id,c])??[]);
  const detail=musicDetail(id,owner),assets=new Map(detail.assets.map(a=>[a.id,a]));
  const lock=db.prepare("UPDATE music_clips SET sync_locked=1 WHERE project_id=? AND id=?");
  for(const clip of detail.clips){
   const old=oldLocks.get(clip.id),asset=assets.get(clip.assetId);
   if(old&&asset?.role==="lip-sync"&&asset.sourceStartMs!==null&&asset.sourceEndMs!==null&&old.assetId===clip.assetId&&old.timelineStartMs===clip.timelineStartMs&&old.sourceInMs===clip.sourceInMs&&old.sourceOutMs===clip.sourceOutMs&&clip.timelineStartMs===asset.sourceStartMs+clip.sourceInMs+range.positionMs-range.startMs&&asset.sourceStartMs+clip.sourceOutMs<=asset.sourceEndMs)lock.run(id,clip.id);
  }
  if(changed.changes!==1)throw new MusicError("Project changed. Reload to continue.",409);
  const insert=db.prepare("INSERT INTO music_asset_cloud(asset_id,project_id,owner_id,object_key,sha256,bytes) VALUES (?,?,?,?,?,?)");
  for(const {slot,record} of records)insert.run(id+":"+slot+":"+version,id,owner,record.key,record.sha256,record.bytes);
  db.exec("COMMIT");
 }catch(e){db.exec("ROLLBACK");throw e;}
 return musicDetail(id,owner);
}
export function queueUnusedSongUpload(id:string,owner:string,version:string,slot:SongSlot,record:ProjectCloudRecord){
 database().prepare("INSERT INTO music_asset_cloud(asset_id,project_id,owner_id,object_key,sha256,bytes,pending_delete) VALUES (?,?,?,?,?,?,1) ON CONFLICT(asset_id) DO NOTHING").run(id+":"+slot+":"+version,id,owner,record.key,record.sha256,record.bytes);
}

export function admitProjectOperation(root:string,owner:string,kind:OperationKind,bytes:number){return reserveProjectOperation(database(),root,owner,kind,bytes);}
