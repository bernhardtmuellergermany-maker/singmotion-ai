/**
 * Operator-host-only encrypted archive handoff. Does NOT read production
 * volumes or databases, mount Railway storage, or call HiDrive from Railway.
 * Accepts ONLY previously produced encrypted SQLite / age PostgreSQL bundles.
 * Uploads to unique Rclone crypt prefixes on a separate private HiDrive remote.
 *
 * Real customer-data transfer is never automatic and requires an independent,
 * explicit privacy/storage/cost approval on the isolated operator host.
 */
import {createHash,randomBytes} from "node:crypto";
import {createReadStream,readFileSync,lstatSync,readdirSync,realpathSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {readConfigSections} from "./offsite-r2-backup.mjs";

const SQLITE_NAMES=["commerce.sqlite","live-test.sqlite","demo.sqlite"];
const SQLITE_FILES=[...SQLITE_NAMES.map(x=>x+".aes-256-gcm"),"manifest.json"];
const POSTGRES_FILES=["cms.dump.age","cms.dump.age.sha256"];
const TYPES=new Set(["sqlite","postgres"]);
const safeRunId=/^\d{8}T\d{6}Z-[0-9a-f]{16}$/;

function privateFile(file,maxBytes=Number.MAX_SAFE_INTEGER){
 const st=lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<1||st.size>maxBytes||
    (st.mode&0o077)!==0||
    (process.getuid&&st.uid!==process.getuid()))
  throw Error("UNSAFE_ENCRYPTED_ARCHIVE");
 return st;
}
function privateDir(dir){
 if(typeof dir!=="string"||!path.isAbsolute(dir))throw Error("PRIVATE_ARCHIVE_DIRECTORY_REQUIRED");
 const st=lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
    (process.getuid&&st.uid!==process.getuid())||
    realpathSync(dir)!==path.resolve(dir))
  throw Error("PRIVATE_ARCHIVE_DIRECTORY_REQUIRED");
 return dir;
}
async function sha256(file){
 const h=createHash("sha256");
 for await(const chunk of createReadStream(file))h.update(chunk);
 return h.digest("hex");
}
function exactFiles(actual,expected){
 if(actual.length!==expected.length||
   actual.some(x=>!expected.includes(x)))throw Error("UNEXPECTED_ARCHIVE_FILE");
}
export async function validateEncryptedBundle(dir,type){
 if(!TYPES.has(type))throw Error("ARCHIVE_TYPE_REQUIRED");
 const root=privateDir(dir),names=type==="sqlite"?SQLITE_FILES:POSTGRES_FILES;
 exactFiles(readdirSync(root),names);
 for(const filename of names)privateFile(path.join(root,filename),filename==="manifest.json"?16384:Number.MAX_SAFE_INTEGER);
 const checksums={};
 if(type==="sqlite"){
  let manifest;
  try{manifest=JSON.parse(readFileSync(path.join(root,"manifest.json"),"utf8"));}
  catch{throw Error("INVALID_ENCRYPTED_ARCHIVE_MANIFEST");}
  if(manifest?.format!=="singmotion-sqlite-aes256gcm-v1"||
    manifest.kdf?.algorithm!=="scrypt"||manifest.kdf.N!==32768||
    manifest.kdf.r!==8||manifest.kdf.p!==1||
    !Array.isArray(manifest.files)||manifest.files.length!==3)
    throw Error("INVALID_ENCRYPTED_ARCHIVE_MANIFEST");
  const entries=new Map(manifest.files.map(f=>[f?.database,f]));
  if(entries.size!==3)throw Error("INVALID_ENCRYPTED_ARCHIVE_MANIFEST");
  for(const name of SQLITE_NAMES){
   const entry=entries.get(name),file=name+".aes-256-gcm";
   if(entry?.archive!==file||typeof entry.ciphertextSha256!=="string"||
     !/^[a-f0-9]{64}$/.test(entry.ciphertextSha256))
    throw Error("INVALID_ENCRYPTED_ARCHIVE_MANIFEST");
   const hash=await sha256(path.join(root,file));
   if(hash!==entry.ciphertextSha256)throw Error("ENCRYPTED_ARCHIVE_HASH_MISMATCH");
   checksums[file]=hash;
  }
  checksums["manifest.json"]=await sha256(path.join(root,"manifest.json"));
 }else{
  const checksum=readFileSync(path.join(root,"cms.dump.age.sha256"),"utf8");
  const match=checksum.match(/^([0-9a-f]{64})  cms\.dump\.age\n?$/);
  if(!match)throw Error("INVALID_AGE_ARCHIVE_CHECKSUM");
  const head=readFileSync(path.join(root,"cms.dump.age"),{encoding:null,flag:"r"}).subarray(0,22).toString("utf8");
  if(!head.startsWith("age-encryption.org/v1"))throw Error("NOT_AN_AGE_ARCHIVE");
  const hash=await sha256(path.join(root,"cms.dump.age"));
  if(hash!==match[1])throw Error("ENCRYPTED_ARCHIVE_HASH_MISMATCH");
  checksums["cms.dump.age"]=hash;
  checksums["cms.dump.age.sha256"]=await sha256(path.join(root,"cms.dump.age.sha256"));
 }
 return {root,kind:type,files:names,checksums};
}

export function validatePrivateHidriveCrypt(config,cryptName){
 if(typeof cryptName!=="string"||!/^[A-Za-z][\w-]{0,63}$/.test(cryptName))
  throw Error("INVALID_CRYPT_REMOTE");
 const remotes=readConfigSections(config),crypt=remotes.get(cryptName);
 if(!crypt||crypt.type!=="crypt"||crypt.filename_encryption!=="standard"||
    !crypt.password||!crypt.remote||crypt.directory_name_encryption==="false")
  throw Error("UNVERIFIED_CRYPT_REMOTE");
 const m=crypt.remote.match(/^([A-Za-z][\w-]{0,63}):([A-Za-z0-9][A-Za-z0-9._/-]*)$/);
 if(!m||m[1]===cryptName||m[2].includes("..")||m[2].includes("//")||
    m[2].toLowerCase().split("/").includes("public"))
  throw Error("UNSAFE_HIDRIVE_BACKING_FOLDER");
 const hidrive=remotes.get(m[1]);
 if(!hidrive||hidrive.type!=="hidrive"||!hidrive.token||
   (hidrive.endpoint&&!/^https:\/\/api\.hidrive\.strato\.com\/2\.1\/?$/.test(hidrive.endpoint)))
  throw Error("PRIVATE_HIDRIVE_REMOTE_REQUIRED");
 return {cryptName,backingType:"hidrive"};
}
export function buildEncryptedArchivePlan({root,kind,cryptName,runId}){
 if(!TYPES.has(kind)||!path.isAbsolute(root)||
   !/^[A-Za-z][\w-]{0,63}$/.test(cryptName)||!safeRunId.test(runId))
  throw Error("INVALID_ARCHIVE_COPY_PLAN");
 const target=cryptName+":"+kind+"/"+runId;
 return {source:root,target,steps:[
  ["size","--json",root],
  ["copy",root,target,"--immutable","--transfers","2","--checkers","4","--retries","2","--log-level","ERROR"],
  ["check",root,target,"--download","--one-way","--log-level","ERROR"],
  ["size","--json",target]
 ]};
}
function execRclone(args,cfg,capture){
 const p=spawnSync("rclone",args,{shell:false,
  env:{...process.env,RCLONE_CONFIG:cfg},
  stdio:["ignore",capture?"pipe":"ignore","ignore"],
  maxBuffer:262144,timeout:0
 });
 if(p.error||p.status!==0)throw Error("OFFSITE_ARCHIVE_OPERATION_FAILED");
 if(!capture)return null;
 const v=JSON.parse(String(p.stdout));
 if(!Number.isSafeInteger(v?.count)||v.count<0||
    !Number.isSafeInteger(v?.bytes)||v.bytes<0)
  throw Error("INVALID_OFFSITE_ARCHIVE_SIZE");
 return {count:v.count,bytes:v.bytes};
}
export async function executeEncryptedArchiveCopy(bundle,plan,cfg,runner=execRclone){
 if(bundle.root!==plan.source||!TYPES.has(bundle.kind))throw Error("UNVERIFIED_ARCHIVE_SOURCE");
 const initial=runner(plan.steps[0],cfg,true);
 if(!initial||initial.count!==bundle.files.length||initial.bytes<1)
  throw Error("INVALID_ARCHIVE_INVENTORY");
 runner(plan.steps[1],cfg,false);
 runner(plan.steps[2],cfg,false);
 const final=runner(plan.steps[3],cfg,true);
 if(!final||initial.count!==final.count||initial.bytes!==final.bytes)
  throw Error("ENCRYPTED_ARCHIVE_OFFSITE_MISMATCH");
 // A changed local archive invalidates the otherwise successful remote check.
 for(const filename of bundle.files)
  if(await sha256(path.join(bundle.root,filename))!==bundle.checksums[filename])
   throw Error("SOURCE_ARCHIVE_CHANGED_DURING_COPY");
 return {ok:true,kind:bundle.kind,files:final.count,bytes:final.bytes,
  runId:plan.target.split("/").at(-1),offsiteCopyVerified:true,
  isolatedRestoreVerified:false};
}
function operatorConfig(file){
 if(typeof file!=="string"||!path.isAbsolute(file))throw Error("PRIVATE_CONFIG_REQUIRED");
 privateFile(file,65536);
 if(realpathSync(file)!==path.resolve(file))throw Error("PRIVATE_CONFIG_REQUIRED");
 return readFileSync(file,"utf8");
}
async function main(){
 const refused={ok:false,code:"TRUSTED_OPERATOR_ARCHIVE_TRANSFER_REQUIRED"};
 try{
  if(process.argv.length!==3||process.argv[2]!=="--confirm-immutable-encrypted-offsite-copy"||
   process.getuid?.()===0||process.env.RAILWAY_ENVIRONMENT_ID||
   process.env.RAILWAY_SERVICE_NAME||
   process.env.OFFSITE_TRANSFER_PRIVACY_APPROVED!=="YES")
    throw Error("EXPLICIT_OFFSITE_APPROVAL_REQUIRED");
  const configPath=process.env.RCLONE_CONFIG;
  const cryptName=process.env.RCLONE_OFFSITE_CRYPT;
  const type=process.env.ENCRYPTED_ARCHIVE_KIND;
  const bundle=await validateEncryptedBundle(process.env.ENCRYPTED_ARCHIVE_DIR,type);
  validatePrivateHidriveCrypt(operatorConfig(configPath),cryptName);
  const runId=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")+
   "-"+randomBytes(8).toString("hex");
  const plan=buildEncryptedArchivePlan({root:bundle.root,kind:type,cryptName,runId});
  const result=await executeEncryptedArchiveCopy(bundle,plan,configPath);
  process.stdout.write("OFFSITE_ENCRYPTED_ARCHIVE "+JSON.stringify(result)+"\n");
 }catch{
  process.stderr.write("OFFSITE_ENCRYPTED_ARCHIVE "+JSON.stringify(refused)+"\n");
  process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 await main();
