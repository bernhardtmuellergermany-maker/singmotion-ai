import type {DatabaseSync} from "node:sqlite";
import {publicCreditReleaseApproved} from "./public-credit-release.ts";

export const PUBLIC_WELCOME_CREDITS=100;
export const PUBLIC_WELCOME_ACCOUNT_LIMIT=50;

/** Public, reviewed production release only — never a private Beta/staging gift. */
export function publicWelcomeCreditsEnabled(env:Record<string,string|undefined>):boolean{
 return env.CUSTOMER_PUBLIC_WELCOME_CREDITS_ENABLED==="true"&&publicCreditReleaseApproved(env);
}

/** Only called inside the new-account BEGIN IMMEDIATE transaction.
 * Durable non-PII counter survives account deletions and app restarts.
 * Counter and ledger award commit together, or both roll back.
 */
export function grantPublicWelcomeCredits(db:DatabaseSync,customerId:string):boolean{
 if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(customerId))throw Error("Invalid new customer ID");
 db.exec(`CREATE TABLE IF NOT EXISTS public_welcome_grant_counter(
  id INTEGER PRIMARY KEY CHECK(id=1),
  issued INTEGER NOT NULL DEFAULT 0 CHECK(issued>=0 AND issued<=${PUBLIC_WELCOME_ACCOUNT_LIMIT})
 )`);
 db.prepare("INSERT OR IGNORE INTO public_welcome_grant_counter(id,issued) VALUES(1,0)").run();
 const reference="public-welcome:v1:"+customerId;
 if(db.prepare("SELECT 1 FROM credit_wallet_ledger WHERE reference=?").get(reference))return false;
 const changed=db.prepare("UPDATE public_welcome_grant_counter SET issued=issued+1 WHERE id=1 AND issued<?")
  .run(PUBLIC_WELCOME_ACCOUNT_LIMIT);
 if(changed.changes!==1)return false;
 db.prepare(`INSERT INTO credit_wallet_ledger
  (id,subject,delta,kind,reference,created) VALUES(?,?,?,'public-welcome',?,?)`)
  .run(reference,"customer:"+customerId,PUBLIC_WELCOME_CREDITS,reference,Date.now());
 return true;
}
