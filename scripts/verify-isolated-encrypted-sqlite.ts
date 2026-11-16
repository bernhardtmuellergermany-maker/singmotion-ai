import {pathToFileURL} from "node:url";
import path from "node:path";
import {verifyIsolatedEncryptedSqliteArchive} from "../lib/ops/verify-isolated-encrypted-sqlite.ts";

/**
 * Private recovery host only; uses an already exported encrypted archive.
 * Never invoked by app startup, public server routes, or the worker.
 * Never print paths, manifests, private content or the passphrase.
 */
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length!==3||
    process.argv[2]!=="--confirm-isolated-offline-restore"||
    process.getuid?.()===0||
    !process.env.RESTORE_ENCRYPTED_ARCHIVE_DIR||
    !process.env.RESTORE_PRIVATE_SCRATCH_DIR||
    !process.env.BACKUP_PASSPHRASE||
    process.env.RAILWAY_ENVIRONMENT_ID){
  console.error("ISOLATED_ENCRYPTED_SQLITE_RESTORE",JSON.stringify({
   ok:false,verified:[],failed:["ISOLATED_RESTORE_CONFIRMATION_REQUIRED"]
  }));
  process.exitCode=2;
 }else{
  const report=await verifyIsolatedEncryptedSqliteArchive(
   process.env.RESTORE_ENCRYPTED_ARCHIVE_DIR,
   process.env.RESTORE_PRIVATE_SCRATCH_DIR,
   process.env.BACKUP_PASSPHRASE
  );
  console.log("ISOLATED_ENCRYPTED_SQLITE_RESTORE",JSON.stringify(report));
  if(!report.ok)process.exitCode=1;
 }
}
