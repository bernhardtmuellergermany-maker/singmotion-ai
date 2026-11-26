import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm,stat} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {projectPreviewArgs,previewByteLimit,mobilePreviewVersion} from "../lib/music-video/preview-profile.ts";
import {createAudioPreview} from "../lib/media.ts";
test("real 720p mobile previews keep orientation, smaller originals and high quality audio",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sm-preview-quality-"));
 try{
  for(const [width,height,wantW,wantH] of [[1920,1080,1280,720],[1080,1920,720,1280],[640,360,640,360]]){
   const input=path.join(dir,"source-"+width+"-"+height+".mp4"),output=input+".preview.mp4";
   execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","color=c=blue:s="+width+"x"+height+":r=30","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","1","-c:v","libx264","-threads","1","-preset","ultrafast","-c:a","aac","-b:a","256k","-ac","2","-pix_fmt","yuv420p",input]);
   execFileSync("ffmpeg",projectPreviewArgs(input,output,true));
   const streams=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-of","json",output],{encoding:"utf8"})).streams;
   const v=streams.find((x:{codec_type:string})=>x.codec_type==="video"),a=streams.find((x:{codec_type:string})=>x.codec_type==="audio");
   assert.equal(v.width,wantW);assert.equal(v.height,wantH);assert.equal(v.codec_name,"h264");assert.equal(v.level,31);assert.equal(v.avg_frame_rate,"30/1");
   assert.equal(a.codec_name,"aac");assert.equal(a.channels,2);assert.ok((await stat(output)).size<=previewByteLimit(true));
  }
  const wav=path.join(dir,"song.wav"),mp3=path.join(dir,"song.mp3");
  execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","2","-ac","2",wav]);
  await createAudioPreview(wav,mp3,256);
  const audio=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-of","json",mp3],{encoding:"utf8"})).streams[0];
  assert.equal(audio.codec_name,"mp3");assert.equal(audio.bit_rate,"256000");
  assert.ok(mobilePreviewVersion.includes("720"));assert.equal(previewByteLimit(false),24*1024*1024);
 }finally{await rm(dir,{recursive:true,force:true});}
});
