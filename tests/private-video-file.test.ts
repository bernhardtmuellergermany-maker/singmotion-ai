import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm,link,symlink,rename,chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {openVerifiedPaidVideoFile,streamVerifiedPaidVideoRange} from "../lib/commerce/private-video-file.ts";

const first="11111111-1111-4111-8111-111111111111";
const second="22222222-2222-4222-8222-222222222222";

test("private download opens the exact paid MP4 and preserves its bytes",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"sm-private-video-"));
 const media=path.join(root,"media");
 try{
  await mkdir(media);
  const file=path.join(media,`paid-${first}.mp4`);
  const bytes=Buffer.from("private-video-offline-fixture");
  await writeFile(file,bytes,{mode:0o600});
  const {handle,size}=await openVerifiedPaidVideoFile(media,file,first,bytes.length);
  try{
   assert.equal(size,bytes.length);
   const buffer=Buffer.alloc(size);
   const result=await handle.read(buffer,0,size,0);
   assert.equal(result.bytesRead,size);
   assert.deepEqual(buffer,bytes);
  }finally{await handle.close();}
  await assert.rejects(openVerifiedPaidVideoFile(media,file,second,bytes.length));
  await assert.rejects(openVerifiedPaidVideoFile(media,file,first,bytes.length+1));
  await assert.rejects(openVerifiedPaidVideoFile(media,path.join(media,"unrelated.mp4"),first,bytes.length));

  // A paid MP4 must not be readable by other OS users, even if the path matches.
  await chmod(file,0o644);
  await assert.rejects(openVerifiedPaidVideoFile(media,file,first,bytes.length));
  await chmod(file,0o600);

  const hard=path.join(media,"hardlinked.mp4");
  await link(file,hard);
  await assert.rejects(openVerifiedPaidVideoFile(media,file,first,bytes.length));
  await rm(hard);
  const moved=path.join(media,"detached.mp4");
  await rename(file,moved);
  await symlink(moved,file);
  await assert.rejects(openVerifiedPaidVideoFile(media,file,first,bytes.length));
  await rm(file);
  await rename(moved,file);
  const changed=Buffer.from("changed content");
  await writeFile(file,changed);
  await assert.rejects(openVerifiedPaidVideoFile(media,file,first,bytes.length));
  await assert.rejects(openVerifiedPaidVideoFile(media,file,"../secret",changed.length));
 }finally{
  await rm(root,{recursive:true,force:true});
 }
});

test("private paid MP4 file cannot resolve outside its root directory",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"sm-private-video-external-"));
 try{
  const media=path.join(root,"media");
  await mkdir(media);
  const foreign=path.join(root,"foreign.mp4");
  const data=Buffer.from("not-an-owned-video");
  await writeFile(foreign,data);
  const file=path.join(media,`paid-${first}.mp4`);
  await symlink(foreign,file);
  await assert.rejects(openVerifiedPaidVideoFile(media,file,first,data.length));
 }finally{await rm(root,{recursive:true,force:true});}
});

test("private video byte ranges return exact bytes and cancelled streams close their handles",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"sm-private-range-"));
 const media=path.join(root,"media");
 try{
  await mkdir(media);
  const file=path.join(media,`paid-${first}.mp4`);
  const bytes=Buffer.alloc(512*1024,0x61);
  for(let i=0;i<bytes.length;i+=97)bytes[i]=0x42;
  await writeFile(file,bytes,{mode:0o600});
  const firstOpen=await openVerifiedPaidVideoFile(media,file,first,bytes.length);
  const output=await new Response(streamVerifiedPaidVideoRange(firstOpen.handle,201,700)).arrayBuffer();
  assert.deepEqual(Buffer.from(output),bytes.subarray(201,701));

  const partial=await openVerifiedPaidVideoFile(media,file,first,bytes.length);
  const reader=streamVerifiedPaidVideoRange(partial.handle,0,bytes.length-1).getReader();
  const firstChunk=await reader.read();
  assert.equal(firstChunk.done,false);
  assert.ok(firstChunk.value?.length);
  await reader.cancel("customer closed the preview");
  // Cancellation must ultimately close the underlying FileHandle.
  for(let i=0;i<50&&partial.handle.fd!==-1;i++)
   await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(partial.handle.fd,-1);

  const aborted=await openVerifiedPaidVideoFile(media,file,first,bytes.length);
  const controller=new AbortController();
  controller.abort();
  const abortedReader=streamVerifiedPaidVideoRange(aborted.handle,0,bytes.length-1,controller.signal).getReader();
  await assert.rejects(abortedReader.read(),/abort/i);
  for(let i=0;i<50&&aborted.handle.fd!==-1;i++)
   await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(aborted.handle.fd,-1);
 }finally{await rm(root,{recursive:true,force:true});}
});
