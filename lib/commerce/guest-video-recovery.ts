/** Email-based recovery of an account-free order after a guest loses the
 * original browser session. The raw proof is never stored and can be redeemed
 * once. Every redemption rotates the old private link/cookie. */
import {randomBytes,createHash} from "node:crypto";
import type {CommerceStore} from "./store.ts";
import {sendRightsEmail} from "./consumer-rights.ts";
import {customerIdentityOrigin} from "../customer-identity-origin.ts";
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
export function ensureGuestRecovery(store:CommerceStore){
 store.db.exec(`CREATE TABLE IF NOT EXISTS customer_guest_email_recovery(
  order_id TEXT PRIMARY KEY,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,
  issued_at INTEGER NOT NULL)`);
}
export async function requestGuestOrderRecovery(
 store:CommerceStore,orderId:string,email:string,
 env:Record<string,string|undefined>=process.env,
 sender:typeof fetch=fetch,
):Promise<boolean>{
 ensureGuestRecovery(store);
 const origin=customerIdentityOrigin(env);
 if(!origin||!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return false;
 const row=store.db.prepare(`SELECT email,account_id,guest_hash FROM customer_orders WHERE id=?`)
  .get(orderId) as {email:string;account_id:string|null;guest_hash:string|null}|undefined;
 if(!row||row.account_id!==null||!row.guest_hash||row.email!==email.trim().toLowerCase()||
    !store.guestMediaOwner(orderId))return false;
 const existing=store.db.prepare("SELECT issued_at FROM customer_guest_email_recovery WHERE order_id=?")
   .get(orderId) as {issued_at:number}|undefined;
 if(existing&&existing.issued_at>Date.now()-60_000)return false;
 const token=randomBytes(32).toString("base64url");
 const now=Date.now();
 store.db.prepare(`INSERT INTO customer_guest_email_recovery VALUES(?,?,?,?)
   ON CONFLICT(order_id) DO UPDATE SET code_hash=excluded.code_hash,
   expires_at=excluded.expires_at,issued_at=excluded.issued_at`)
  .run(orderId,digest(token),now+20*60_000,now);
 const ok=await sendRightsEmail({
   to:row.email,subject:"SingMotion AI – Privaten Videozugang wiederherstellen",
   text:["Du hast einen einmaligen Zugang zu deiner Gastbestellung angefordert.",
    "Der Link läuft nach 20 Minuten ab und kann nur einmal benutzt werden.",
    "",
    origin+"/orders/"+orderId+"#recover="+encodeURIComponent(token),
    "",
    "Nach der Wiederherstellung sind zuvor gespeicherte Gastlinks nicht mehr gültig.",
    "Wenn du diese E-Mail nicht angefordert hast, ignoriere sie."].join("\n"),
 },env,sender);
 if(!ok)store.db.prepare("DELETE FROM customer_guest_email_recovery WHERE order_id=? AND code_hash=?")
  .run(orderId,digest(token));
 return ok;
}
export function redeemGuestOrderRecovery(store:CommerceStore,orderId:string,token:string):string|null{
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 ensureGuestRecovery(store);
 store.db.exec("BEGIN IMMEDIATE");
 try{
  const row=store.db.prepare(`SELECT r.code_hash,r.expires_at,o.guest_hash,o.account_id
   FROM customer_guest_email_recovery r JOIN customer_orders o ON o.id=r.order_id
   WHERE r.order_id=?`).get(orderId) as {code_hash:string;expires_at:number;guest_hash:string|null;account_id:string|null}|undefined;
  if(!row||row.account_id!==null||!row.guest_hash||row.expires_at<=Date.now()||
      row.code_hash!==digest(token)||!store.guestMediaOwner(orderId)){
   store.db.exec("ROLLBACK");return null;
  }
  const renewed=randomBytes(32).toString("base64url");
  const changed=store.db.prepare("UPDATE customer_orders SET guest_hash=?,guest_expiry=? WHERE id=? AND guest_hash=?")
   .run(digest(renewed),Date.now()+90*86400000,orderId,row.guest_hash);
  if(changed.changes!==1)throw Error("Concurrent guest access recovery");
  store.db.prepare("DELETE FROM customer_guest_email_recovery WHERE order_id=?").run(orderId);
  store.db.exec("COMMIT");
  return renewed;
 }catch(e){store.db.exec("ROLLBACK");throw e}
}
