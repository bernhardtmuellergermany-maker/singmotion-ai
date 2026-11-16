import {createDecipheriv,createHash,scryptSync} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {lstat,mkdtemp,readFile,realpath,rm} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {DatabaseSync} from "node:sqlite";
import path from "node:path";
import {auditCreditLedger} from "../commerce/credit-ledger-integrity.ts";
import {CRITICAL_SQLITE_NAMES} from "./sqlite-restore-drill.ts";

type ArchiveEntry={
 database:string;archive:string;salt:string;iv:string;authTag:string;
 ciphertextSha256:string;plaintextSha256:string;
};
type ArchiveManifest={
 format:string;kdf:{algorithm:string;N:number;r:number;p:number};files:ArchiveEntry[];
};
export type IsolatedArchiveReport={ok:boolean;verified:string[];failed:string[]};

function hex(value:unknown,bytes:number):value is string{
 return typeof value==="string"&&value.length===bytes*2&&/^[0-9a-f]+$/.test(value);
}
function within(parent:string,child:string){
 const rel=path.relative(parent,child);
 return rel===""||(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel));
}
async function ownerPrivateDirectory(directory:string){
 const stat=await lstat(directory);
 if(!stat.isDirectory()||(stat.mode&0o077)!==0||
    (process.getuid&&stat.uid!==process.getuid()))throw Error("unsafe-directory");
 return realpath(directory);
}
async function hashFile(file:string){
 const sha=createHash("sha256");
 for await(const data of createReadStream(file))sha.update(data);
 return sha.digest("hex");
}
function sqliteHealthy(file:string,checkCreditLedger:boolean){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  db.exec("PRAGMA query_only=ON");
  const result=db.prepare("PRAGMA quick_check(1)").get() as {quick_check?:string}|undefined;
  return result?.quick_check==="ok"&&
   (!checkCreditLedger||auditCreditLedger(db).ok);
 }finally{db.close();}
}
function validManifest(m:unknown):m is ArchiveManifest{
 if(!m||typeof m!=="object")return false;
 const a=m as Partial<ArchiveManifest>;
 if(a.format!=="singmotion-sqlite-aes256gcm-v1"||a.kdf?.algorithm!=="scrypt"||
    a.kdf.N!==32768||a.kdf.r!==8||a.kdf.p!==1||
    !Array.isArray(a.files)||a.files.length!==CRITICAL_SQLITE_NAMES.length)return false;
 const entries=new Map<string,ArchiveEntry>(a.files.map(x=>[x?.database,x] as [string,ArchiveEntry]));
 if(entries.size!==CRITICAL_SQLITE_NAMES.length)return false;
 for(const name of CRITICAL_SQLITE_NAMES){
  const x=entries.get(name);
  if(!x||x.archive!==name+".aes-256-gcm"||
     !hex(x.salt,16)||!hex(x.iv,12)||!hex(x.authTag,16)||
     !hex(x.ciphertextSha256,32)||!hex(x.plaintextSha256,32))return false;
 }
 return true;
}
/**
 * Rehearse decryption of an already exported encrypted SQLite archive on a
 * separate isolated operator host. No Railway/Stripe/Cloudflare/BytePlus IO.
 *
 * The operator, not this function, must independently attest offsite retention,
 * key-recovery custody and whether this archive came from actual Production.
 */
export async function verifyIsolatedEncryptedSqliteArchive(
 archiveDir:string,scratchParent:string,passphrase:string,
):Promise<IsolatedArchiveReport>{
 const report:IsolatedArchiveReport={ok:false,verified:[],failed:[]};
 let scratch:string|null=null;
 try{
  if(!path.isAbsolute(archiveDir)||!path.isAbsolute(scratchParent)||
     typeof passphrase!=="string"||passphrase.length<32){
   report.failed.push("ISOLATED_RESTORE_PARAMETERS_INVALID");
   return report;
  }
  const [archiveRoot,scratchRoot]=await Promise.all([
   ownerPrivateDirectory(archiveDir),ownerPrivateDirectory(scratchParent)
  ]);
  if(within(archiveRoot,scratchRoot)||within(scratchRoot,archiveRoot)){
   report.failed.push("ISOLATED_RESTORE_PATH_OVERLAP");return report;
  }
  const manifestFile=path.join(archiveRoot,"manifest.json");
  const manifestStat=await lstat(manifestFile);
  if(!manifestStat.isFile()||manifestStat.nlink!==1||manifestStat.size>16_384||
     (manifestStat.mode&0o077)!==0)throw Error("unsafe-manifest");
  const manifest:unknown=JSON.parse(await readFile(manifestFile,"utf8"));
  if(!validManifest(manifest))throw Error("invalid-manifest");
  scratch=await mkdtemp(path.join(scratchRoot,"singmotion-isolated-restore-"));
  for(const name of CRITICAL_SQLITE_NAMES){
   const entry=manifest.files.find(x=>x.database===name)!;
   const encrypted=path.join(archiveRoot,entry.archive);
   const target=path.join(scratch,name);
   const fileStat=await lstat(encrypted);
   if(!fileStat.isFile()||fileStat.nlink!==1||
      (fileStat.mode&0o077)!==0)throw Error("unsafe-ciphertext");
   if(await hashFile(encrypted)!==entry.ciphertextSha256)
    throw Error("ciphertext-hash-mismatch");
   const key=scryptSync(passphrase,Buffer.from(entry.salt,"hex"),32,{
    N:32768,r:8,p:1,maxmem:64*1024*1024
   });
   try{
    const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(entry.iv,"hex"));
    decipher.setAuthTag(Buffer.from(entry.authTag,"hex"));
    await pipeline(createReadStream(encrypted),decipher,createWriteStream(target,{
     flags:"wx",mode:0o600
    }));
   }finally{key.fill(0);}
   if(await hashFile(target)!==entry.plaintextSha256||
      !sqliteHealthy(target,name==="commerce.sqlite"))throw Error("restored-db-invalid");
   report.verified.push(name);
  }
 }catch{
  report.failed.push("ISOLATED_ENCRYPTED_SQLITE_RESTORE_FAILED");
 }finally{
  if(scratch){
   try{await rm(scratch,{force:true,recursive:true});}
   catch{report.failed.push("PRIVATE_RESTORE_SCRATCH_CLEANUP_FAILED");}
  }
 }
 report.ok=report.failed.length===0&&
  report.verified.length===CRITICAL_SQLITE_NAMES.length;
 return report;
}
