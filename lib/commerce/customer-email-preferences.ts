import type {DatabaseSync} from "node:sqlite";

/** Account-owned email preferences. Security and payment receipts are not optional. */
export function ensureCustomerEmailPreferences(db:DatabaseSync):void{
 db.exec(`CREATE TABLE IF NOT EXISTS customer_email_preferences(
  account_id TEXT PRIMARY KEY,
  video_ready_enabled INTEGER NOT NULL DEFAULT 1 CHECK(video_ready_enabled IN(0,1)),
  updated_at INTEGER NOT NULL DEFAULT 0
 )`);
}
export function customerVideoReadyEmailPreference(db:DatabaseSync,accountId:string):{
 enabled:boolean;updatedAt:number
}{
 ensureCustomerEmailPreferences(db);
 const row=db.prepare("SELECT video_ready_enabled,updated_at FROM customer_email_preferences WHERE account_id=?")
  .get(accountId) as {video_ready_enabled:number;updated_at:number}|undefined;
 return {enabled:row?.video_ready_enabled!==0,updatedAt:row?.updated_at||0};
}
export function updateCustomerVideoReadyEmailPreference(db:DatabaseSync,accountId:string,enabled:boolean){
 ensureCustomerEmailPreferences(db);
 db.prepare(`INSERT INTO customer_email_preferences(account_id,video_ready_enabled,updated_at)
  VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET
  video_ready_enabled=excluded.video_ready_enabled,updated_at=excluded.updated_at`)
  .run(accountId,enabled?1:0,Date.now());
}
export function shouldSendCustomerVideoReadyEmail(
 db:DatabaseSync,accountId:string|null,videoCompletedAt:number
):boolean{
 if(!accountId)return true; // Guest orders have no account preference.
 const preference=customerVideoReadyEmailPreference(db,accountId);
 return preference.enabled && (preference.updatedAt===0||videoCompletedAt>=preference.updatedAt);
}
