#!/usr/bin/env node
/** Independent #230 restore-authorization bridge. New owner-authorized
 * user,ro HiDrive profile comes ONLY from protected Railway variable.
 * Never sends OAuth data to GitHub, ChatGPT or logs. Does not modify HiDrive.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const secretName='RESTORE_HIDRIVE_RO_RCLONE_CONFIG_B64';
const sourceProject='96ab3402-f974-4cdf-b9a3-408443b17025';
const sourceEnvs=new Set(['36adc41d-7e54-4396-ad1a-fd432ba0441d','dfaeabed-03df-43ed-aa71-50f343a75041']);
const fail=code=>{throw new Error(code);};

export function parsePrivateReadOnlyProfile(encoded,remote){
  if(typeof encoded!=='string'||encoded.length<32||encoded.length>32768||
      encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    fail('RESTORE_RO_CONFIG_ENCODING_INVALID');
  const raw=Buffer.from(encoded,'base64');
  if(raw.length<64||raw.length>16384||raw.toString('base64')!==encoded||raw.includes(0))
    fail('RESTORE_RO_CONFIG_ENCODING_INVALID');
  const plain=raw.toString('utf8');
  if(!Buffer.from(plain,'utf8').equals(raw))fail('RESTORE_RO_CONFIG_UTF8_INVALID');
  if(typeof remote!=='string'||
     !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}:(?:[a-zA-Z0-9_-]{1,80}\/)*SingMotion-DR$/.test(remote))
    fail('RESTORE_RO_REMOTE_INVALID');
  const section=remote.slice(0,remote.indexOf(':'));
  const sections=new Map();let current=null;
  for(const line of plain.replaceAll('\r\n','\n').split('\n')){
    const s=line.trim();
    if(!s||s.startsWith(';')||s.startsWith('#'))continue;
    if(/^\[[^\]]+\]$/.test(s)){
      current=s.slice(1,-1);
      if(sections.has(current))fail('RESTORE_RO_CONFIG_DUPLICATE_SECTION');
      sections.set(current,new Map());continue;
    }
    if(current===null||!/^[a-zA-Z0-9_]+\s*=/.test(s))
      fail('RESTORE_RO_CONFIG_FORMAT_INVALID');
    const offset=s.indexOf('=');
    const key=s.slice(0,offset).trim(),value=s.slice(offset+1).trim();
    if(sections.get(current).has(key))fail('RESTORE_RO_CONFIG_DUPLICATE_KEY');
    sections.get(current).set(key,value);
  }
  if(sections.size!==1||!sections.has(section))fail('RESTORE_RO_CONFIG_REMOTE_MISMATCH');
  const fields=sections.get(section);
  if(fields.get('type')!=='hidrive'||(fields.has('scope_role')&&fields.get('scope_role')!=='user')||
     fields.get('scope_access')!=='ro'||!fields.has('token'))
    fail('RESTORE_RO_CONFIG_SCOPE_INVALID');
  let token;
  try{token=JSON.parse(fields.get('token'));}catch{fail('RESTORE_RO_CONFIG_TOKEN_INVALID');}
  if(!token||typeof token.access_token!=='string'||token.access_token.length<8||
     typeof token.refresh_token!=='string'||token.refresh_token.length<8)
    fail('RESTORE_RO_CONFIG_TOKEN_INVALID');
  // Child independently confirms *granted* user,ro scope using tokeninfo.
  return raw;
}
async function runChild(command,args,env){
  return await new Promise((resolve,reject)=>{
    const c=spawn(command,args,{env,stdio:'inherit',shell:false});
    c.once('error',()=>reject(Error('RESTORE_PROCESS_FAILED')));
    c.once('close',(code,signal)=>resolve(code===0&&!signal?0:1));
  });
}
async function main(){
  if((process.getuid&&process.getuid()===0)||
     process.env.RAILWAY_PROJECT_ID===sourceProject||
     sourceEnvs.has(process.env.RAILWAY_ENVIRONMENT_ID))
    fail('RESTORE_SOURCE_ENVIRONMENT_REFUSED');
  const encoded=process.env[secretName];
  if(!encoded){
    console.error('RESTORE_RO_GRANT_NOT_PROVISIONED');
    // Retain 30-min private Console availability; no false PASS.
    process.exitCode=await runChild('/bin/sleep',['1800'],{PATH:'/usr/bin:/bin'});
    return;
  }
  const raw=parsePrivateReadOnlyProfile(encoded,process.env.RESTORE_HIDRIVE_RO_REMOTE);
  let folder;
  try{
    folder=await mkdtemp(path.join(os.tmpdir(),'sm230-ro-'));
    const filename=path.join(folder,'rclone.conf');
    await writeFile(filename,raw,{mode:0o600,flag:'wx'});
    const childEnv={...process.env,RESTORE_HIDRIVE_RO_RCLONE_CONFIG:filename};
    delete childEnv[secretName];
    console.log('RESTORE_RO_MANIFEST_PREFLIGHT_START');
    const code=await runChild(process.execPath,[
      '/opt/singmotion/scripts/hidrive-readonly-commit-preflight.mjs','--manifest-only'
    ],childEnv);
    console.log(code===0?'RESTORE_RO_MANIFEST_PREFLIGHT_PASS':'RESTORE_RO_MANIFEST_PREFLIGHT_FAIL');
    process.exitCode=code;
  }finally{
    raw.fill(0);
    if(folder)await rm(folder,{recursive:true,force:true});
  }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)
  main().catch(e=>{
    const message=typeof e?.message==='string'&&/^[A-Z0-9_]{4,90}$/.test(e.message)
      ?e.message:'RESTORE_AUTHORIZATION_BOOTSTRAP_FAILED';
    console.error(message);process.exitCode=1;
  });