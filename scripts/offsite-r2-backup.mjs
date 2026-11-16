import {randomBytes} from "node:crypto";
import {readFileSync,lstatSync,realpathSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {pathToFileURL} from "node:url";

/**
 * Operator-only, outside Railway. A copy is ALWAYS in a newly named prefix.
 * No live credentials, volume access, delete/sync/restore operations,
 * customer file paths, or customer media are printed by this command.
 *
 * This program requires a trusted owner-controlled Rclone config with:
 * - a source read-only Cloudflare R2 S3 remote; and
 * - a crypt remote wrapping a DIFFERENT storage provider (S3/B2 or
 *   STRATO HiDrive) with independent credentials.
 */
export function readConfigSections(text){
 const sections=new Map();
 let current=null;
 for(const line of text.split(/\r?\n/)){
  const section=line.match(/^\s*\[([A-Za-z][\w-]{0,63})\]\s*$/);
  if(section){current=section[1];if(sections.has(current))throw Error("DUPLICATE_REMOTE");sections.set(current,{});continue;}
  const pair=line.match(/^\s*([A-Za-z][\w-]*)\s*=\s*(.*?)\s*$/);
  if(pair&&current){sections.get(current)[pair[1]]=pair[2];}
 }
 return sections;
}
export function validateOffsiteRemotes(config,sourceRemote,destinationCryptRemote){
 const names=[sourceRemote,destinationCryptRemote];
 if(names.some(name=>typeof name!=="string"||!/^[A-Za-z][\w-]{0,63}$/.test(name))||
    names[0]===names[1])throw Error("INVALID_REMOTES");
 const sections=readConfigSections(config);
 const source=sections.get(sourceRemote),crypt=sections.get(destinationCryptRemote);
 if(!source||source.type!=="s3"||
    !/\.r2\.cloudflarestorage\.com(?::443)?\/?$/i.test(source.endpoint||"")||
    !crypt||crypt.type!=="crypt"||
    !crypt.password||crypt.filename_encryption==="off"||
    !crypt.remote)throw Error("SOURCE_OR_ENCRYPTION_NOT_VERIFIED");
 const backingMatch=crypt.remote.match(/^([A-Za-z][\w-]{0,63}):([^:]*)$/);
 if(!backingMatch||!backingMatch[2]||backingMatch[1]===sourceRemote)
  throw Error("INDEPENDENT_DESTINATION_NOT_VERIFIED");
 const backing=sections.get(backingMatch[1]);
 if(!backing||!["s3","b2","hidrive"].includes(backing.type)||
    (/\.r2\.cloudflarestorage\.com/i.test(backing.endpoint||""))||
    (/railway/i.test(backing.endpoint||"")))throw Error("INDEPENDENT_DESTINATION_NOT_VERIFIED");
 // HiDrive is supported through its official OAuth backend; no FTP or
 // public webspace is involved. Custom endpoints must stay at STRATO.
 if(backing.type==="hidrive"&&(
    (backing.endpoint&&!/^https:\/\/api\.hidrive\.strato\.com\/2\.1\/?$/.test(backing.endpoint))||
    !backing.token||
    /(^|\/)public(\/|$)/i.test(backingMatch[2])))
    throw Error("STRATO_HIDRIVE_OAUTH_NOT_VERIFIED");
 // Note: endpoint checks are a guard, not proof of separate legal ownership,
 // deletion protection, geographical residency or object-lock retention.
 return {sourceRemote,destinationCryptRemote,backingType:backing.type};
}
export function validateRemotePath(name){
 if(typeof name!=="string"||name.length<4||name.length>250||
    !/^([A-Za-z][\w-]{0,63}):([A-Za-z0-9][A-Za-z0-9._/-]*)$/.test(name)||
    name.includes("..")||name.includes("//")||name.endsWith("/"))
  throw Error("UNSAFE_REMOTE_PATH");
 return name;
}
export function buildOffsiteCopyPlan({sourcePath,destinationCryptRemote,runId}){
 validateRemotePath(sourcePath);
 if(!/^[A-Za-z][\w-]{0,63}$/.test(destinationCryptRemote)||
    !/^\d{8}T\d{6}Z-[a-f0-9]{16}$/.test(runId))
  throw Error("INVALID_OFFSITE_RUN");
 const destination=destinationCryptRemote+":r2/"+runId;
 return {
  source:sourcePath,destination,
  steps:[
   ["size","--json",sourcePath],
   ["copy",sourcePath,destination,"--immutable","--transfers","2","--checkers","4","--retries","2","--low-level-retries","2","--log-level","ERROR"],
   ["check",sourcePath,destination,"--download","--one-way","--log-level","ERROR"],
   ["size","--json",destination]
  ]
 };
}
function privateConfig(file){
 if(!path.isAbsolute(file))throw Error("PRIVATE_CONFIG_REQUIRED");
 const info=lstatSync(file);
 if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||
    (process.getuid&&info.uid!==process.getuid()))throw Error("PRIVATE_CONFIG_REQUIRED");
 const normalized=realpathSync(file);
 return readFileSync(normalized,"utf8");
}
function executeRclone(args,configFile,capture){
 const child=spawnSync("rclone",args,{
  env:{...process.env,RCLONE_CONFIG:configFile},
  stdio:["ignore",capture?"pipe":"ignore","ignore"],
  maxBuffer:1024*256,timeout:0,
 });
 if(child.error||child.status!==0)throw Error("BACKUP_OPERATION_FAILED");
 if(!capture)return null;
 const v=JSON.parse(String(child.stdout));
 const count=Number(v?.count),bytes=Number(v?.bytes);
 if(!Number.isSafeInteger(count)||count<0||
    !Number.isSafeInteger(bytes)||bytes<0)throw Error("INVALID_SIZE_REPORT");
 return {count,bytes};
}
export function executeOffsiteBackup(plan,configFile,runner=executeRclone){
 const first=runner(plan.steps[0],configFile,true);
 if(!first||first.count<1)throw Error("EMPTY_OR_UNAVAILABLE_SOURCE");
 runner(plan.steps[1],configFile,false);
 runner(plan.steps[2],configFile,false);
 const last=runner(plan.steps[3],configFile,true);
 if(!last||first.count!==last.count||first.bytes!==last.bytes)
  throw Error("OFFSITE_INVENTORY_MISMATCH");
 return {ok:true,count:last.count,bytes:last.bytes,runId:plan.destination.split("/").at(-1)};
}
function cli(){
 const refusal={ok:false,code:"TRUSTED_OPERATOR_OFFSITE_CONFIGURATION_REQUIRED"};
 try{
  if(process.argv.length!==3||
     process.argv[2]!=="--confirm-encrypted-immutable-copy"||
     process.env.RAILWAY_ENVIRONMENT_ID||
     process.getuid?.()===0||
     process.env.OFFSITE_COPY_COST_AND_PRIVACY_APPROVED!=="YES")
    throw Error("OPERATOR_CONFIRMATION_REQUIRED");
  const source=process.env.RCLONE_R2_SOURCE;
  const target=process.env.RCLONE_OFFSITE_CRYPT;
  const cfg=process.env.RCLONE_CONFIG;
  if(!source||!target||!cfg)throw Error("MISSING_OFFSITE_CONFIGURATION");
  const config=privateConfig(cfg);
  const sourceName=source.split(":")[0];
  validateOffsiteRemotes(config,sourceName,target);
  const t=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const runId=t+"-"+randomBytes(8).toString("hex");
  const plan=buildOffsiteCopyPlan({sourcePath:source,destinationCryptRemote:target,runId});
  const result=executeOffsiteBackup(plan,cfg);
  process.stdout.write("R2_OFFSITE_BACKUP "+JSON.stringify(result)+"\n");
 }catch{
  process.stderr.write("R2_OFFSITE_BACKUP "+JSON.stringify(refusal)+"\n");
  process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)cli();
