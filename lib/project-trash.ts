import type {DatabaseSync} from "node:sqlite";

/** Account files stay recoverable for thirty complete days after deletion.
 * Billing, immutable provider/Stripe evidence and invoices are NOT project files. */
export const PROJECT_TRASH_DAYS=30;
export const PROJECT_TRASH_MS=PROJECT_TRASH_DAYS*24*60*60*1000;
export const trashDeadline=(deletedAt:number)=>deletedAt+PROJECT_TRASH_MS;

export function ensureDraftTrash(db:DatabaseSync):void{
 db.exec("CREATE TABLE IF NOT EXISTS studio_drafts (id TEXT PRIMARY KEY,owner TEXT NOT NULL,selection TEXT NOT NULL,artist_name TEXT NOT NULL,step INTEGER NOT NULL,updated INTEGER NOT NULL)");
 const columns=db.prepare("PRAGMA table_info(studio_drafts)").all() as {name:string}[];
 if(!columns.some(c=>c.name==="project_name"))db.exec("ALTER TABLE studio_drafts ADD COLUMN project_name TEXT NOT NULL DEFAULT ''");
 if(!columns.some(c=>c.name==="deleted_at"))db.exec("ALTER TABLE studio_drafts ADD COLUMN deleted_at INTEGER DEFAULT NULL");
 db.exec("CREATE INDEX IF NOT EXISTS idx_draft_trash ON studio_drafts(deleted_at)");
}
export function ensureLiveTrash(db:DatabaseSync):void{
 const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='live_studio_projects'").get();
 if(!exists)return;
 const cols=db.prepare("PRAGMA table_info(live_studio_projects)").all() as {name:string}[];
 if(!cols.some(c=>c.name==="deleted_at"))db.exec("ALTER TABLE live_studio_projects ADD COLUMN deleted_at INTEGER DEFAULT NULL");
 db.exec("CREATE INDEX IF NOT EXISTS idx_live_trash ON live_studio_projects(deleted_at)");
}
/** Fail closed instead of reviving a deleted id through an existing draft POST. */
export function deleteDraftToTrash(db:DatabaseSync,id:string,owner:string,now=Date.now()){
 ensureDraftTrash(db);
 const changed=db.prepare("UPDATE studio_drafts SET deleted_at=? WHERE id=? AND owner=? AND deleted_at IS NULL")
  .run(now,id,owner);
 if(Number(changed.changes)!==1)throw Error("Draft unavailable or already deleted.");
 return {deleted:true,deletedAt:now,purgeAfter:trashDeadline(now)};
}
export function restoreDraftFromTrash(db:DatabaseSync,id:string,owner:string,now=Date.now()){
 ensureDraftTrash(db);
 const changed=db.prepare("UPDATE studio_drafts SET deleted_at=NULL WHERE id=? AND owner=? AND deleted_at IS NOT NULL AND deleted_at>?")
  .run(id,owner,now-PROJECT_TRASH_MS);
 if(Number(changed.changes)!==1)throw Error("Draft is unavailable or its restoration period has expired.");
 return {restored:true};
}
export function currentDraft(db:DatabaseSync,id:string,owner:string){
 ensureDraftTrash(db);
 return db.prepare("SELECT * FROM studio_drafts WHERE id=? AND owner=? AND deleted_at IS NULL").get(id,owner);
}
export function listDraftTrash(db:DatabaseSync,owner:string,now=Date.now()){
 ensureDraftTrash(db);
 const rows=db.prepare("SELECT id,project_name,artist_name,deleted_at FROM studio_drafts WHERE owner=? AND deleted_at IS NOT NULL AND deleted_at>? ORDER BY deleted_at DESC LIMIT 60")
  .all(owner,now-PROJECT_TRASH_MS) as {id:string;project_name:string;artist_name:string;deleted_at:number}[];
 return rows.map(r=>({id:r.id,name:r.project_name||r.artist_name||"Untitled project",deletedAt:r.deleted_at,purgeAfter:trashDeadline(r.deleted_at),kind:"draft" as const}));
}
