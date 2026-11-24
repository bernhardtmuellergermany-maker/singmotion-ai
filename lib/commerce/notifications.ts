import type {DatabaseSync} from "node:sqlite";

/** Project metadata may be shown with a credit charge only after proving
 * that the immutable ledger event, settled reservation and completed private
 * output all belong to the same signed-in principal. Never trust a URL ID.
 */
export function creditedVideoProject(
 commerce:DatabaseSync,live:DatabaseSync|null,subject:string,reference:string,
):{name:string;href:string}|null{
 if(!live)return null;
 const match=/^video-charge:([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.exec(reference);
 if(!match)return null;
 const projectId=match[1];
 const identity=/^customer:([a-f0-9-]{36})$/i.exec(subject)
  ||/^super-admin:([A-Za-z0-9_-]{1,100})$/.exec(subject);
 if(!identity)return null;
 const owner=subject.startsWith("customer:")?"customer-"+identity[1]:"cms-staff-"+identity[1];
 try{
  const hold=commerce.prepare(
   "SELECT 1 FROM credit_video_reservations WHERE project_id=? AND subject=? AND state='settled'"
  ).get(projectId,subject);
  if(!hold)return null;
  const row=live.prepare(
   "SELECT p.display_name,p.project_name,p.artist_name,a.data FROM live_studio_projects p "+
   "JOIN live_attempts a ON a.id=p.attempt_id "+
   "WHERE p.attempt_id=? AND p.owner=? AND p.deleted_at IS NULL"
  ).get(projectId,owner) as {display_name:string;project_name:string;artist_name:string;data:string}|undefined;
  if(!row)return null;
  const attempt=JSON.parse(row.data) as {media?:{owner?:string};state?:string;outputPath?:string|null};
  if(attempt.media?.owner!==owner||attempt.state!=="completed"||
     typeof attempt.outputPath!=="string"||!attempt.outputPath)return null;
  const name=[row.display_name,row.project_name,row.artist_name]
   .map(v=>typeof v==="string"?v.trim():"").find(v=>v.length>0&&v.length<=80) || "Untitled video";
  return {name,href:"/videos/live_"+projectId};
 }catch{
  // A legacy/temporarily unavailable project database never changes the
  // immutable wallet event or falsely suggests that a video is accessible.
  return null;
 }
}


type DeletedCreditVideo={name:string;href:null};
const chargeId=(reference:string)=>/^video-charge:([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.exec(reference)?.[1];
function paidVideoOwner(commerce:DatabaseSync,subject:string,reference:string):{id:string;owner:string}|null{
 const id=chargeId(reference);
 const identity=/^customer:([a-f0-9-]{36})$/i.exec(subject)||/^super-admin:([A-Za-z0-9_-]{1,100})$/.exec(subject);
 if(!id||!identity)return null;
 const paid=commerce.prepare("SELECT 1 FROM credit_wallet_ledger l JOIN credit_video_reservations r ON r.project_id=? AND r.subject=l.subject WHERE l.subject=? AND l.reference=? AND l.kind='video' AND l.delta<0 AND r.state='settled'").get(id,subject,reference);
 return paid?{id,owner:(subject.startsWith("customer:")?"customer-":"cms-staff-")+identity[1]}:null;
}
function projectTitle(row:{display_name?:unknown;project_name?:unknown;artist_name?:unknown}):string{
 return [row.display_name,row.project_name,row.artist_name].map(v=>typeof v==="string"?v.trim():"")
  .find(v=>v.length>0&&v.length<=80)||"Untitled video";
}
function deletedCreditVideo(commerce:DatabaseSync,live:DatabaseSync,subject:string,reference:string):DeletedCreditVideo|null{
 const paid=paidVideoOwner(commerce,subject,reference);
 if(!paid)return null;
 const attempt=live.prepare("SELECT data FROM live_attempts WHERE id=?").get(paid.id) as {data:string}|undefined;
 if(!attempt)return null;
 const data=JSON.parse(attempt.data) as {state?:string;media?:{owner?:string}};
 if(data.state!=="completed"||data.media?.owner!==paid.owner)return null;
 const row=live.prepare("SELECT * FROM live_studio_projects WHERE attempt_id=?").get(paid.id) as {owner:string;deleted_at:number|null;display_name?:string;project_name?:string;artist_name?:string}|undefined;
 if(row)return row.owner===paid.owner&&typeof row.deleted_at==="number"&&row.deleted_at>0?{name:projectTitle(row),href:null}:null;
 // Permanent purge keeps only an owner-verified name in the existing action
 // history, which full account erasure already removes by attempt_id.
 if(!live.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='live_studio_actions'").get())return null;
 const snapshot=live.prepare("SELECT evidence FROM live_studio_actions WHERE attempt_id=? AND action='credit-history-deleted' AND actor=? ORDER BY id DESC LIMIT 1").get(paid.id,paid.owner) as {evidence:string}|undefined;
 if(!snapshot)return null;
 const name=(JSON.parse(snapshot.evidence) as {name?:unknown}).name;
 return typeof name==="string"&&name.trim().length>0&&name.length<=80?{name,href:null}:null;
}
/** Called within the same live DB transaction as permanent trash removal.
 * Keep no media, prompt or URL; only a title for an actual settled charge.
 */
export function preserveDeletedCreditVideo(commerce:DatabaseSync,live:DatabaseSync,id:string,owner:string,deletedAt:number):void{
 const subject=owner.startsWith("customer-")?"customer:"+owner.slice(9):owner.startsWith("cms-staff-")?"super-admin:"+owner.slice(10):"";
 if(!subject||!commerce.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='credit_wallet_ledger'").get()||
    !commerce.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='credit_video_reservations'").get())return;
 const paid=paidVideoOwner(commerce,subject,"video-charge:"+id);
 if(!paid||paid.owner!==owner)return;
 const row=live.prepare("SELECT * FROM live_studio_projects WHERE attempt_id=? AND owner=? AND deleted_at=?").get(id,owner,deletedAt) as {display_name?:string;project_name?:string;artist_name?:string}|undefined;
 if(!row)return;
 const title=deletedCreditVideo(commerce,live,subject,"video-charge:"+id);
 if(!title)return;
 live.exec("CREATE TABLE IF NOT EXISTS live_studio_actions (id INTEGER PRIMARY KEY,attempt_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,evidence TEXT NOT NULL,created_at INTEGER NOT NULL)");
 live.prepare("INSERT INTO live_studio_actions (attempt_id,action,actor,evidence,created_at) VALUES (?,'credit-history-deleted',?,?,?)").run(id,owner,JSON.stringify({name:title.name}),deletedAt);
}
function creditHistoryVideo(commerce:DatabaseSync,live:DatabaseSync|null,subject:string,reference:string):{name:string;href:string|null}|null{
 const active=creditedVideoProject(commerce,live,subject,reference);
 if(active)return active;
 if(!live)return null;
 try{return deletedCreditVideo(commerce,live,subject,reference);}catch{return null;}
}

/** Enrich already-account-scoped wallet entries without changing their financial data. */
export function creditEntriesWithVideoProjects<T extends {type:string;reference:string}>(
 commerce:DatabaseSync,live:DatabaseSync|null,subject:string,entries:readonly T[],
):Array<T&{video:{name:string;href:string|null}|null}>{
 return entries.map(entry=>({...entry,video:entry.type==="video"
  ?creditHistoryVideo(commerce,live,subject,entry.reference):null}));
}

/** Account-scoped inbox; source payment ledger remains immutable when a notice is deleted. */
export type Notice={id:string;title:string;message:string;created:number;read:boolean;kind:"payment"|"video"|"announcement"|"gift";href:string};
export class NotificationInbox {
 private readonly db:DatabaseSync;
 private readonly live:DatabaseSync|null;
 constructor(db:DatabaseSync,live:DatabaseSync|null=null){
  this.db=db;
  this.live=live;
  db.exec(`CREATE TABLE IF NOT EXISTS notification_user_state(
    subject TEXT NOT NULL,notice_id TEXT NOT NULL,read_at INTEGER,deleted_at INTEGER,
    PRIMARY KEY(subject,notice_id)
   );
   CREATE TABLE IF NOT EXISTS notification_announcements(
    id TEXT PRIMARY KEY,title TEXT NOT NULL,message TEXT NOT NULL,
    audience TEXT NOT NULL CHECK(audience IN ('all','customers')),
    category TEXT NOT NULL CHECK(category IN ('update','offer','important')),
    published_at INTEGER NOT NULL,expires_at INTEGER
   );`);
 }
 private rows(subject:string):Array<{id:string;title:string;message:string;created:number;kind:Notice["kind"];href:string}>{
  const ledger=this.db.prepare(`SELECT id,kind,delta,created,reference FROM credit_wallet_ledger
   WHERE subject=? AND kind IN ('purchase','refund','dispute','video','video-service-refund','support-video-refund','support-video-goodwill','auto-video-credit-return','manual-gift','manual-gift-correction','public-welcome')
   ORDER BY created DESC LIMIT 150`).all(subject) as Array<{id:string;kind:string;delta:number;created:number;reference:string}>;
  const items:Array<{id:string;title:string;message:string;created:number;kind:Notice["kind"];href:string}>=ledger.map(row=>{
   const n=Math.abs(row.delta).toLocaleString("en-GB");
   if(row.kind==="purchase")return {id:"wallet:"+row.id,title:"Credits purchased",message:n+" credits added to your wallet.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="public-welcome")return {
    id:"wallet:"+row.id,title:"Welcome Credits received",
    message:n+" free welcome Credits have been added to your wallet.",
    created:row.created,kind:"gift" as const,href:"/credits#usage"
   };
   if(row.kind==="manual-gift")return {
    id:"wallet:"+row.id,title:"Gift Credits received",
    message:n+" gift Credits have been added to your wallet.",
    created:row.created,kind:"gift" as const,href:"/credits#usage"
   };
   if(row.kind==="manual-gift-correction")return {
    id:"wallet:"+row.id,title:"Gift Credits adjusted",
    message:n+" gift Credits removed after an account correction.",
    created:row.created,kind:"payment" as const,href:"/credits#usage"
   };
   if(row.kind==="refund")return {id:"wallet:"+row.id,title:"Refund completed",message:n+" credits reversed following a refunded payment.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="dispute")return {id:"wallet:"+row.id,title:"Payment reversed",message:n+" credits reversed after a payment dispute.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="video"){
    const project=creditedVideoProject(this.db,this.live,subject,row.reference);
    return {id:"wallet:"+row.id,title:"Video credits used",
      message:project?n+" credits used for “"+project.name+"”.":n+" credits used for your video.",
      created:row.created,kind:"video" as const,href:project?.href||"/credits#usage"};
   }
   // A released reservation has a zero-delta event: the customer regains
   // spendable reserved Credits, not an extra positive ledger top-up.
   const refundId=/^(?:auto-video-return|support-video-goodwill|support-video-refund|video-release|video-service-refund):([a-f0-9-]{36})$/i.exec(row.reference)?.[1];
   const reservation=refundId?this.db.prepare("SELECT credits FROM credit_video_reservations WHERE project_id=? AND subject=? AND state='released'")
     .get(refundId,subject) as {credits:number}|undefined:undefined;
   const returned=row.delta>0?row.delta:reservation?.credits??0;
   return {id:"wallet:"+row.id,title:"Video credits returned",message:returned.toLocaleString("en-GB")+" credits returned to your available wallet.",created:row.created,kind:"video" as const,href:"/credits#usage"};
  });
  const global=this.db.prepare(`SELECT id,title,message,published_at,audience FROM notification_announcements
    WHERE published_at<=? AND (expires_at IS NULL OR expires_at>?)
      AND (audience='all' OR ? LIKE 'customer:%')
    ORDER BY published_at DESC LIMIT 50`).all(Date.now(),Date.now(),subject) as Array<{id:string;title:string;message:string;published_at:number}>;
  for(const row of global)items.push({id:"announcement:"+row.id,title:row.title,message:row.message,created:row.published_at,kind:"announcement",href:"/notifications"});
  return items;
 }
 list(subject:string):{notifications:Notice[];unread:number}{
  const states=this.db.prepare("SELECT notice_id,read_at,deleted_at FROM notification_user_state WHERE subject=?").all(subject) as Array<{notice_id:string;read_at:number|null;deleted_at:number|null}>;
  const status=new Map(states.map(row=>[row.notice_id,row]));
  const notifications=this.rows(subject).filter(row=>!status.get(row.id)?.deleted_at)
   .sort((a,b)=>b.created-a.created).slice(0,100)
   .map(row=>({...row,read:!!status.get(row.id)?.read_at}));
  return {notifications,unread:notifications.filter(row=>!row.read).length};
 }
 mutate(subject:string,action:"read"|"unread"|"delete"|"read-all"|"clear-all",id?:string):void{
  const visible=this.rows(subject).map(row=>row.id);
  const now=Date.now();
  const update=this.db.prepare(`INSERT INTO notification_user_state(subject,notice_id,read_at,deleted_at)
   VALUES(?,?,?,?)
   ON CONFLICT(subject,notice_id) DO UPDATE SET
   read_at=excluded.read_at,deleted_at=COALESCE(notification_user_state.deleted_at,excluded.deleted_at)`);
  if(action==="read-all"||action==="clear-all"){
   const current=this.list(subject).notifications;
   for(const row of current)update.run(subject,row.id,now,action==="clear-all"?now:null);
   return;
  }
  if(!id||id.length>160||!visible.includes(id))throw Error("Unknown notification");
  if(action==="delete"){update.run(subject,id,now,now);return;}
  if(action==="read"){update.run(subject,id,now,null);return;}
  // Unread is ignored once a notice is deleted, preventing accidental resurrection.
  update.run(subject,id,null,null);
 }
}
