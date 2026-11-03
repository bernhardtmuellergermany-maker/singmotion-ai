import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm,link,symlink,rename} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {openVerifiedPaidVideoFile} from "../lib/commerce/private-video-file.ts";

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
