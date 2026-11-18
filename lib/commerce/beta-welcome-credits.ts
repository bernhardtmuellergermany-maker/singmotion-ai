/** One-time 250 Credit gift for newly created, privately gated Beta accounts.
 * This never changes purchased Credits, top-up settlement or payment gates.
 */
import type { DatabaseSync } from "node:sqlite";
import { customerCreditStudioBetaEnabled } from "./customer-credit-studio-beta.ts";
import { privateInternationalCreditBetaEnabled } from "./private-international-credit-beta.ts";

export const BETA_WELCOME_CREDITS = 250;
const STAGING = "dfaeabed-03df-43ed-aa71-50f343a75041";

export function betaWelcomeCreditsEnabled(env:Record<string,string|undefined>):boolean {
  if(env.CUSTOMER_BETA_WELCOME_CREDITS_ENABLED!=="true")return false;
  // A public customer signup alone must never trigger a Beta promotion.
  return privateInternationalCreditBetaEnabled(env) ||
    (env.RAILWAY_ENVIRONMENT_ID===STAGING && customerCreditStudioBetaEnabled(env));
}

/** Must be invoked only from the verified new-account creation transaction.
 * credit_wallet_ledger is initialized by CreditWallet before this call.
 * Its unique reference survives restarts and prevents double grants.
 */
export function grantBetaWelcomeCredits(db:DatabaseSync,customerId:string):boolean {
  if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(customerId))
    throw Error("Invalid new Beta customer ID");
  const subject="customer:"+customerId;
  const reference="beta-welcome:v1:"+customerId;
  const inserted=db.prepare(`INSERT OR IGNORE INTO credit_wallet_ledger
    (id,subject,delta,kind,reference,created) VALUES(?, ?, ?, 'beta-welcome', ?, ?)`)
    .run(reference,subject,BETA_WELCOME_CREDITS,reference,Date.now());
  return inserted.changes===1;
}
