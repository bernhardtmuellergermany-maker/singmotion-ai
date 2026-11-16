import {backup,DatabaseSync} from "node:sqlite";
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,scryptSync} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {lstat,mkdir,mkdtemp,realpath,rm,writeFile} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import path from "node:path";
import {auditCreditLedger} from "../commerce/credit-ledger-integrity.ts";
import {CRITICAL_SQLITE_NAMES} from "./sqlite-restore-drill.ts";

/**
 * Manual operator-only export: consistent SQLite -> encrypted archive ->
 * independently decrypted scratch copy -> integrity and ledger verification.
 * NEVER scheduled or called from the public app/worker. No Stripe/provider IO.
 * It does NOT prove that the destination is offsite or that Postgres/R2 restore.
 */
export type EncryptedSqliteReport={
 ok:boolean;
 bundle:string|null;
 verified:string[];
 failed:string[];
};
type Entry={
 database:string;
 archive:string;
 salt:string;
 iv:string;
 authTag:string;
 ciphertextSha256:string;
 plaintextSha256:string;
};
const below=(root:string,child:string)=>{
 const relative=path.relative(root,child);
 return relative===""||(!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative));
};
async function sha256(file:string){
 const hash=createHash("sha256");
 for await (const block of createReadStream(file))hash.update(block);
 return hash.digest("hex");
}
function checkDb(file:string,commerce:boolean){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  db.exec("PRAGMA query_only=ON");
  const integrity=db.prepare("PRAGMA quick_check(1)").get() as {quick_check?:string}|undefined;
  if(integrity?.quick_check!=="ok")return false;
  return !commerce||auditCreditLedger(db).ok;
 }finally{db.close();}
}
async function privateDirectory(dir:string){
 const before=await lstat(dir);
 if(!before.isDirectory()||(before.mode&0o077)!==0)return null;
 if(process.getuid&&before.uid!==process.getuid())return null;
 return realpath(dir);
}
export async function exportEncryptedSqlite(
 sourceDir:string,outputDir:string,scratchDir:string,passphrase:string,
):Promise<EncryptedSqliteReport>{
 const report:EncryptedSqliteReport={ok:false,bundle:null,verified:[],failed:[]};
 let scratch:string|null=null,bundlePath:string|null=null;
 let success=false;
 try{
  if(![sourceDir,outputDir,scratchDir].every(path.isAbsolute)||
     typeof passphrase!=="string"||passphrase.length<32){
   report.failed.push("OPERATOR_PARAMETERS_INVALID");return report;
  }
  const source=await realpath(sourceDir);
  const output=await privateDirectory(outputDir);
  const scratchParent=await privateDirectory(scratchDir);
  if(!output||!scratchParent||
     [output,scratchParent].some(p=>below(source,p)||below(p,source))||
     below(output,scratchParent)||below(scratchParent,output)){
   report.failed.push("PRIVATE_ISOLATED_DESTINATIONS_REQUIRED");return report;
  }
  scratch=await mkdtemp(path.join(scratchParent,"singmotion-backup-private-"));
  const bundleName="singmotion-sqlite-"+new Date().toISOString().replaceAll(":","-")+"-"+randomUUID();
  bundlePath=path.join(output,bundleName);
  await mkdir(bundlePath,{mode:0o700});
  const entries:Entry[]=[];
  for(const name of CRITICAL_SQLITE_NAMES){
   const origin=path.join(source,name);
   const sourceInfo=await lstat(origin);
   if(!sourceInfo.isFile()||sourceInfo.nlink!==1)throw Error("unsafe-origin");
   const plain=path.join(scratch,name);
   const verifiedPlain=path.join(scratch,"verified-"+name);
   const archiveName=name+".aes-256-gcm";
   const encrypted=path.join(bundlePath,archiveName);
   const db=new DatabaseSync(origin,{readOnly:true});
   try{await backup(db,plain);}finally{db.close();}
   if(!checkDb(plain,name==="commerce.sqlite"))throw Error("origin-integrity-failed");
   const plaintextSha256=await sha256(plain);
   const salt=randomBytes(16),iv=randomBytes(12);
   const key=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
   let authTag:Buffer;
   try{
    const cipher=createCipheriv("aes-256-gcm",key,iv);
    await pipeline(createReadStream(plain),cipher,createWriteStream(encrypted,{flags:"wx",mode:0o600}));
    authTag=cipher.getAuthTag();
    const decipher=createDecipheriv("aes-256-gcm",key,iv);
    decipher.setAuthTag(authTag);
    await pipeline(createReadStream(encrypted),decipher,createWriteStream(verifiedPlain,{flags:"wx",mode:0o600}));
   }finally{key.fill(0);}
   if(await sha256(verifiedPlain)!==plaintextSha256||
      !checkDb(verifiedPlain,name==="commerce.sqlite"))throw Error("roundtrip-failed");
   entries.push({
    database:name,archive:archiveName,salt:salt.toString("hex"),iv:iv.toString("hex"),
    authTag:authTag.toString("hex"),
    ciphertextSha256:await sha256(encrypted),plaintextSha256
   });
   await rm(plain);
   await rm(verifiedPlain);
   report.verified.push(name);
  }
  await writeFile(path.join(bundlePath,"manifest.json"),JSON.stringify({
   format:"singmotion-sqlite-aes256gcm-v1",createdAt:new Date().toISOString(),
   kdf:{algorithm:"scrypt",N:32768,r:8,p:1},files:entries,
   warning:"SQLite only; offsite storage and independent Postgres/R2 restoration are separate."
  },null,2)+"\n",{flag:"wx",mode:0o600});
  success=true;
  report.bundle=bundleName;
 }catch{
  report.failed.push("ENCRYPTED_SQLITE_EXPORT_FAILED");
 }finally{
  if(scratch){
   try{await rm(scratch,{recursive:true,force:true});}
   catch{report.failed.push("PRIVATE_SCRATCH_CLEANUP_FAILED");success=false;}
  }
  if(!success&&bundlePath){
   try{await rm(bundlePath,{recursive:true,force:true});}
   catch{report.failed.push("INCOMPLETE_ARCHIVE_CLEANUP_FAILED");}
  }
  report.ok=success&&report.failed.length===0&&
   report.verified.length===CRITICAL_SQLITE_NAMES.length;
  if(!report.ok)report.bundle=null;
 }
 return report;
}
