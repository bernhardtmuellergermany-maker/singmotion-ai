import {backup,DatabaseSync} from "node:sqlite";
import {lstat,mkdtemp,realpath,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {auditCreditLedger} from "../commerce/credit-ledger-integrity.ts";

/**
 * Explicit, temporary SQLite backup->restore rehearsal, not an offsite backup.
 * The Node SQLite backup API includes committed WAL pages consistently; a
 * file-level cp of an active SQLite DB would NOT be an adequate substitute.
 *
 * Temporary snapshots contain PRIVATE customer data until removed: only run
 * inside a trusted, operator-controlled host with secure ephemeral storage.
 * The program never emits customer IDs, emails, balances, project IDs or paths.
 *
 * No new provider tasks, Stripe requests, schema migrations, writes to the
 * source databases, or automatic activation are made.
 */
export const CRITICAL_SQLITE_NAMES=[
 "commerce.sqlite","live-test.sqlite","demo.sqlite"
] as const;

export type RestoreDrillReport={
 ok:boolean;
 checked:string[];
 failed:string[];
};

const code=(name:string)=>name.replace(".sqlite","").replaceAll("-","_").toUpperCase();
const beneath=(parent:string,child:string)=>{
 const relative=path.relative(parent,child);
 return relative===""||(!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative));
};

export async function rehearseSqliteRestore(
 sourceRoot:string,
 scratchRoot:string=tmpdir(),
):Promise<RestoreDrillReport>{
 const checked:string[]=[];
 const failed:string[]=[];
 let scratch:string|null=null;
 try{
  if(!path.isAbsolute(sourceRoot)||!path.isAbsolute(scratchRoot))
   return {ok:false,checked,failed:["ABSOLUTE_PATHS_REQUIRED"]};
  const source=await realpath(sourceRoot),scratchParent=await realpath(scratchRoot);
  const [sourceStat,scratchStat]=await Promise.all([lstat(source),lstat(scratchParent)]);
  if(!sourceStat.isDirectory()||!scratchStat.isDirectory()||beneath(source,scratchParent))
   return {ok:false,checked,failed:["ISOLATED_SCRATCH_REQUIRED"]};
  scratch=await mkdtemp(path.join(scratchParent,"singmotion-sqlite-restore-"));
  for(const name of CRITICAL_SQLITE_NAMES){
   let sourceDB:DatabaseSync|undefined,restoredDB:DatabaseSync|undefined;
   const target=path.join(scratch,name);
   try{
    const origin=path.join(source,name);
    const sourceFile=await lstat(origin);
    if(!sourceFile.isFile()||sourceFile.nlink!==1)
     throw Error("Unsafe SQLite source");
    sourceDB=new DatabaseSync(origin,{readOnly:true});
    // SQLite's online backup provides a self-contained, consistent point-in-
    // time file, even when the source is in WAL mode and contains live commits.
    await backup(sourceDB,target);
    sourceDB.close();sourceDB=undefined;
    restoredDB=new DatabaseSync(target,{readOnly:true});
    restoredDB.exec("PRAGMA query_only=ON");
    const integrity=restoredDB.prepare("PRAGMA quick_check(1)").get() as
     {quick_check?:string}|undefined;
    if(integrity?.quick_check!=="ok")throw Error("Restore integrity failed");
    if(name==="commerce.sqlite"){
     const result=auditCreditLedger(restoredDB);
     if(!result.ok){
      failed.push(...result.failed);
      continue;
     }
    }
    checked.push(name);
   }catch{
    failed.push(code(name)+"_RESTORE_FAILED");
   }finally{
    try{restoredDB?.close();}catch{}
    try{sourceDB?.close();}catch{}
   }
  }
  return {ok:failed.length===0,checked,failed};
 }catch{
  return {ok:false,checked,failed:["RESTORE_DRILL_UNAVAILABLE"]};
 }finally{
  if(scratch){
   try{await rm(scratch,{recursive:true,force:true});}
   catch{
    // Failure to delete a temporary PRIVATE copy MUST fail the drill; do
    // not record success if sensitive scratch files could remain.
    failed.push("PRIVATE_SCRATCH_CLEANUP_FAILED");
   }
  }
 }
}
