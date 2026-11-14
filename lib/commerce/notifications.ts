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
  return {name,href:"/projects/live_"+projectId};
 }catch{
  // A legacy/temporarily unavailable project database never changes the
  // immutable wallet event or falsely suggests that a video is accessible.
  return null;
 }
}


/** Account-scoped inbox; source payment ledger remains immutable when a notice is deleted. */
export type Notice={id:string;title:string;message:string;created:number;read:boolean;kind:"payment"|"video"|"announcement";href:string};
export class NotificationInbox {
 private readonly db:DatabaseSync;
 constructor(db:DatabaseSync,private readonly live:DatabaseSync|null=null){
  this.db=db;
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
   WHERE subject=? AND kind IN ('purchase','refund','dispute','video','video-service-refund','support-video-refund')
   ORDER BY created DESC LIMIT 150`).all(subject) as Array<{id:string;kind:string;delta:number;created:number;reference:string}>;
  const items:Array<{id:string;title:string;message:string;created:number;kind:Notice["kind"];href:string}>=ledger.map(row=>{
   const n=Math.abs(row.delta).toLocaleString("en-GB");
   if(row.kind==="purchase")return {id:"wallet:"+row.id,title:"Credits purchased",message:n+" credits added to your wallet.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="refund")return {id:"wallet:"+row.id,title:"Refund completed",message:n+" credits reversed following a refunded payment.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="dispute")return {id:"wallet:"+row.id,title:"Payment reversed",message:n+" credits reversed after a payment dispute.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="video"){
    const project=creditedVideoProject(this.db,this.live,subject,row.reference);
    return {id:"wallet:"+row.id,title:"Video credits used",
      message:project?n+" credits used for “"+project.name+"”.":n+" credits used for your video.",
      created:row.created,kind:"video" as const,href:project?.href||"/credits#usage"};
   }
   return {id:"wallet:"+row.id,title:"Video credits returned",message:n+" credits returned to your wallet.",created:row.created,kind:"video" as const,href:"/credits#usage"};
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
