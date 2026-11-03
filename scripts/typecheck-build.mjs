/** Explicit TypeScript gate. Capture diagnostics for Railway's build-log stream.
 * No network calls, configuration changes or payment/generation side effects. */
import {spawnSync} from "node:child_process";
const result=spawnSync(process.execPath,["node_modules/typescript/bin/tsc","--noEmit","--pretty","false"],{
 encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024,
});
if(result.error||result.signal||result.status!==0){
 for(const line of (result.stdout+"\n"+result.stderr).split(/\r?\n/)){
  if(line.trim())console.log("TYPECHECK_DIAGNOSTIC "+line);
 }
 console.error("TYPECHECK_FAILED",result.error?.message||result.signal||result.status);
 process.exit(1);
}
console.log("TYPECHECK_OK");
