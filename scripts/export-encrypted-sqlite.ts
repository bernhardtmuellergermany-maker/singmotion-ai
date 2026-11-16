import {exportEncryptedSqlite} from "../lib/ops/encrypted-sqlite-export.ts";
import {pathToFileURL} from "node:url";
import path from "node:path";

/**
 * NOT a public endpoint, scheduled worker, or production auto-backup.
 * Run only from a trusted private non-root host with restricted directories,
 * a strong ephemeral passphrase, and an independently secured backup volume.
 */
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length!==3||
    process.argv[2]!=="--confirm-private-encrypted-export"||
    process.getuid?.()===0||
    !process.env.DATA_DIR||!process.env.BACKUP_OUTPUT_DIR||
    !process.env.BACKUP_SCRATCH_DIR||!process.env.BACKUP_PASSPHRASE){
  console.error("ENCRYPTED_SQLITE_BACKUP",JSON.stringify({
   ok:false,bundle:null,verified:[],failed:["EXPLICIT_PRIVATE_OPERATOR_CONFIRMATION_REQUIRED"]
  }));
  process.exitCode=2;
 }else{
  const result=await exportEncryptedSqlite(
   process.env.DATA_DIR,process.env.BACKUP_OUTPUT_DIR,
   process.env.BACKUP_SCRATCH_DIR,process.env.BACKUP_PASSPHRASE,
  );
  console.log("ENCRYPTED_SQLITE_BACKUP",JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
 }
}
