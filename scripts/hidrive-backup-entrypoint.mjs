// Root-owned one-time setup for the worker's dedicated /state volume.
// No access to /app/.data or other services' databases. Drop root before OAuth.
import fs from "node:fs";
const state="/state";
const uid=1000,gid=1000;
const allowed=new Set(["hidrive-oauth.v1.json.enc"]);
function checkAndRepair(){
 const info=fs.lstatSync(state);
 if(!info.isDirectory()||info.isSymbolicLink())throw Error("Invalid private state mount");
 for(const name of fs.readdirSync(state)){
  if(!allowed.has(name))throw Error("Unexpected file in private token volume");
  const file=state+"/"+name;
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)
   throw Error("Invalid private token state file");
  if(process.getuid()===0){
   fs.chownSync(file,uid,gid);
   fs.chmodSync(file,0o600);
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
await import("/app/scripts/hidrive-backup-worker.mjs");
