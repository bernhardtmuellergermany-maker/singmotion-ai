import type {DatabaseSync} from "node:sqlite";

/** Account-scoped inbox; source payment ledger remains immutable when a notice is deleted. */
export type Notice={id:string;title:string;message:string;created:number;read:boolean;kind:"payment"|"video"|"announcement";href:string};
export class NotificationInbox {
 constructor(private readonly db:DatabaseSync){
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
  const ledger=this.db.prepare(`SELECT id,kind,delta,created FROM credit_wallet_ledger
   WHERE subject=? AND kind IN ('purchase','refund','dispute','video','video-service-refund','support-video-refund')
   ORDER BY created DESC LIMIT 150`).all(subject) as Array<{id:string;kind:string;delta:number;created:number}>;
  const items=ledger.map(row=>{
   const n=Math.abs(row.delta).toLocaleString("en-GB");
   if(row.kind==="purchase")return {id:"wallet:"+row.id,title:"Credits purchased",message:n+" credits added to your wallet.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="refund")return {id:"wallet:"+row.id,title:"Refund completed",message:n+" credits reversed following a refunded payment.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="dispute")return {id:"wallet:"+row.id,title:"Payment reversed",message:n+" credits reversed after a payment dispute.",created:row.created,kind:"payment" as const,href:"/credits#usage"};
   if(row.kind==="video")return {id:"wallet:"+row.id,title:"Video credits used",message:n+" credits used for your video.",created:row.created,kind:"video" as const,href:"/credits#usage"};
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
