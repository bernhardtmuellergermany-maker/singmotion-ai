import {DatabaseSync} from "node:sqlite";
import {lstatSync} from "node:fs";
import path from "node:path";
import {auditCreditLedger,type CreditLedgerAudit} from "../lib/commerce/credit-ledger-integrity.ts";

/** Read-only Production/staging wallet audit. Does not open Stripe/BytePlus or
 * modify wallet entries, hold states, customer assets, or SQLite schema. */
export function auditCreditLedgerFile(root:string):CreditLedgerAudit{
 if(!path.isAbsolute(root))throw Error("Absolute private storage required");
 const file=path.join(root,"commerce.sqlite");
 if(!lstatSync(file).isFile())throw Error("Credit database is not a regular file");
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  db.exec("PRAGMA query_only=ON");
  return auditCreditLedger(db);
 }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 try{
  if(process.argv.length!==2||!process.env.DATA_DIR)
   throw Error("DATA_DIR required");
  const result=auditCreditLedgerFile(process.env.DATA_DIR);
  console.log("CREDIT_LEDGER_INTEGRITY",JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
 }catch{
  // Do not log filenames, queries, IDs or customer/payment information.
  console.error("CREDIT_LEDGER_INTEGRITY",JSON.stringify({
   ok:false,failed:["READONLY_AUDIT_UNAVAILABLE"]
  }));
  process.exitCode=1;
 }
}
