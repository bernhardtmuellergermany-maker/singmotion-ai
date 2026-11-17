// Root-owned one-time setup for the worker's dedicated /state volume.
// No access to /app/.data or other services' databases. Drop root before OAuth.
import fs from "node:fs";
const state="/state";
const uid=1000,gid=1000;
const allowed=new Set(["hidrive-oauth.v1.json.enc"]);
const tempName=/^\.oauth-[0-9a-f-]{36}\.tmp$/;
function checkAndRepair(){
 const info=fs.lstatSync(state);
 if(!info.isDirectory()||info.isSymbolicLink())throw Error("Invalid private state mount");
 for(const name of fs.readdirSync(state)){
  const file=state+"/"+name;
  const st=fs.lstatSync(file);
  // Railway creates the filesystem's root-owned lost+found directory on a
  // freshly formatted volume. Ignore it; never traverse, chown or delete it.
  if(name==="lost+found"){
   if(!st.isDirectory()||st.isSymbolicLink())throw Error("Invalid filesystem metadata");
   continue;
  }
  if(!allowed.has(name)&&!tempName.test(name))throw Error("Unexpected file in private token volume");
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)
   throw Error("Invalid private token state file");
  if(process.getuid()===0){
   fs.chownSync(file,uid,gid);
   fs.chmodSync(file,0o600);
   if(tempName.test(name))fs.unlinkSync(file);
  }
 }
 if(process.getuid()===0){
  fs.chownSync(state,uid,gid);
  fs.chmodSync(state,0o700);
 }
}
checkAndRepair();
if(process.getuid()===0){
 process.setgroups([]);
 process.setgid(gid);
 process.setuid(uid);
}
if(process.getuid()!==uid||process.getgid()!==gid||
 process.getgroups().some(group=>group!==gid))throw Error("Refusing privileged worker runtime");
process.umask(0o077);
const {main,SafeError}=await import("/usr/local/lib/hidrive-backup-worker.mjs");
try{
 if(process.env.BACKUP_MODE?.startsWith("PRIVATE_SYNTHETIC_V2:")){
  const {runHiDriveIntegration,receiverEnvironment}=await import("/app/scripts/hidrive-private-integration.mjs");
  await runHiDriveIntegration(receiverEnvironment(process.env));
 }else await main();
}
catch(e){
 console.error("HIDRIVE_BACKUP_FAILED",e instanceof SafeError?e.message:"UNEXPECTED_ERROR");
 process.exitCode=1;
}
