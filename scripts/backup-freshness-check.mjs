#!/usr/bin/env node
/** Read-only audit of a signer-authenticated completed backup attestation.
 * Example on an authorized private runner:
 *  node scripts/backup-freshness-check.mjs /private/backup-attestation.json /private/producer-public.pem
 * Fails closed. Neither reads production media nor starts a backup.
 */
import { readFile, lstat } from "node:fs/promises";
import { evaluateBackupFreshness } from "../lib/ops/backup-freshness-policy.mjs";

const fail = code => { process.stderr.write(code+"\n");process.exitCode=1; };
async function main(){
 if(process.argv.length!==4) throw Error("USAGE_ATTEND_TWO_PRIVATE_PATHS");
 const [attPath,keyPath]=process.argv.slice(2);
 for(const location of [attPath,keyPath]){
   const st=await lstat(location);
   if(!st.isFile()||st.isSymbolicLink()||st.size>16384||st.size===0)
     throw Error("PRIVATE_INPUT_INVALID");
 }
 const document=JSON.parse(await readFile(attPath,"utf8"));
 if(!document || Object.keys(document).sort().join(",")!=="payload,signature")
   throw Error("ATTESTATION_FILE_INVALID");
 const verifierPublicKey=await readFile(keyPath,"utf8");
 const result=evaluateBackupFreshness({
   payload:document.payload,signature:document.signature,verifierPublicKey
 });
 process.stdout.write(JSON.stringify(result)+"\n");
}
main().catch(e=>{
 const code=typeof e.message==="string"&&/^[A-Z][A-Z0-9_]{2,80}$/.test(e.message)
  ?e.message:"BACKUP_FRESHNESS_CHECK_FAILED";
 fail(code);
});
