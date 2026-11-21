/** A Google-only account has no password. Accept a destructive action only
 * after a fresh, provider-verified Google OAuth login minted its own session.
 * Never treat an arbitrary logged-in customer cookie as recent reauthentication.
 */
import {createHash} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";

export function googleOnlyDeletionAccount(db:DatabaseSync,accountId:string):boolean{
 const row=db.prepare("SELECT password_hash FROM customer_accounts WHERE id=?")
  .get(accountId) as {password_hash:string}|undefined;
 return row?.password_hash.startsWith("google-only:")===true;
}
export function recentlyVerifiedGoogleDeletion(
 db:DatabaseSync,accountId:string,token:string,now=Date.now()
):boolean{
 if(!googleOnlyDeletionAccount(db,accountId)||!token)return false;
 const linked=db.prepare("SELECT 1 FROM customer_google_identities WHERE account_id=?")
  .get(accountId);
 if(!linked)return false;
 const row=db.prepare(`SELECT expires FROM customer_sessions
   WHERE token_hash=? AND account_id=? AND expires>?`).get(
    createHash("sha256").update(token).digest("hex"),accountId,now
   ) as {expires:number}|undefined;
 if(!row||!Number.isSafeInteger(row.expires))return false;
 // OAuth login issues 24-hour absolute sessions. Login in last five minutes
 // is equivalent to a fresh Google identity challenge for this account.
 const age=now+86_400_000-row.expires;
 return age>=-60_000&&age<=5*60_000;
}
