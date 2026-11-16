import {rehearseSqliteRestore} from "../lib/ops/sqlite-restore-drill.ts";
import {pathToFileURL} from "node:url";
import path from "node:path";

/**
 * Operator-only diagnostic. It does not create a persistent/offsite backup.
 * It creates and verifies ephemeral PRIVATE SQLite copies and removes them.
 * Never run it on shared scratch storage or in a publicly reachable task.
 */
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length!==3||
    process.argv[2]!=="--confirm-ephemeral-private-copy"||
    !process.env.DATA_DIR||!path.isAbsolute(process.env.DATA_DIR)||
    process.getuid?.()===0){
  console.error("SQLITE_RESTORE_DRILL",JSON.stringify({
   ok:false,checked:[],failed:["EXPLICIT_PRIVATE_OPERATOR_CONFIRMATION_REQUIRED"]
  }));
  process.exitCode=2;
 }else{
  const result=await rehearseSqliteRestore(process.env.DATA_DIR);
  console.log("SQLITE_RESTORE_DRILL",JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
 }
}
