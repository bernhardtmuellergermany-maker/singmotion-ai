import {readFileSync} from "node:fs";
import {test} from "node:test";
import assert from "node:assert/strict";
import {AUDIO_LIMIT,IMAGE_LIMIT,validateFile} from "../lib/domain.ts";
import {sourceAssetLimit} from "../lib/cloud-media.ts";

const source=(relative:string)=>readFileSync(new URL(relative,import.meta.url),"utf8");

test("audio accepts 70 MiB but not one byte more; image limit remains unchanged",()=>{
 assert.equal(AUDIO_LIMIT,70*1024*1024);
 assert.equal(IMAGE_LIMIT,30*1024*1024);
 for(const filename of ["song.wav","song.mp3","song.m4a"])
  assert.doesNotThrow(()=>validateFile(filename,AUDIO_LIMIT,"audio"));
 assert.throws(()=>validateFile("song.wav",AUDIO_LIMIT+1,"audio"),/70 MB/);
 assert.throws(()=>validateFile("photo.png",IMAGE_LIMIT+1,"image"),/30 MB/);
 assert.equal(sourceAssetLimit("audio"),AUDIO_LIMIT);
 assert.equal(sourceAssetLimit("image"),IMAGE_LIMIT);
});

test("every Next.js gateway can carry and verify a 70 MiB audio upload",()=>{
 const config=source("../next.config.mjs");
 const api=source("../app/(site)/api/[...path]/route.ts");
 const musicVideo=source("../app/(site)/api/music-video/[[...parts]]/route.ts");
 const storage=source("../lib/upload-storage.ts");
 assert.match(config,/proxyClientMaxBodySize:\s*"72mb"/);
 assert.match(api,/boundedBody\(req, AUDIO_LIMIT \+ 1024 \* 1024\)/);
 assert.match(api,/readMirroredPrivateSource\(owner,assetId,mirrored,sourceAssetLimit\(a.kind\)\)/);
 assert.match(api,/readMirroredPrivateSource\(owner,a.id,row,sourceAssetLimit\(a.kind\)\)/);
 assert.match(storage,/bytes>AUDIO_LIMIT/);
 assert.match(musicVideo,/fileForm\(req,AUDIO_LIMIT,"song"\)/);
});
