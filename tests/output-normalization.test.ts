import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { probe } from "../lib/media.ts";
import {
  downloadValidatedOutput,
  validateOutput,
  providerNativeOutputContract,
  hasNoNonSquarePixelAspect,
  type OutputValidationContract,
} from "../lib/live/output.ts";

test("786x1178 BytePlus video keeps exact provider-native dimensions; no broad acceptance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sm-normalize-"));
  const policy: OutputValidationContract = {
    outputHosts: ["approved.example.test"],
    output: {
      width: 720,
      height: 1280,
      fps: 25,
      videoCodec: "h264",
      audioCodec: "aac",
      durationToleranceSeconds: 0.15,
      maxDurationSeconds: 2,
    },
  };
  const ff = (args: string[]) =>
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", ...args], {
      maxBuffer: 4 * 1024 * 1024,
    });
  try {
    const raw = path.join(root, "source.mp4");
    ff([
      "-f",
      "lavfi",
      "-i",
      "color=red:s=786x1178:r=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      raw,
    ]);
    const bytes = await readFile(raw);
    await assert.rejects(validateOutput(raw, 1, policy), /DIMENSIONS/); // raw never eligible for publication
    const file = path.join(root, "private.mp4");
    await downloadValidatedOutput(
      "https://approved.example.test/video",
      file,
      1,
      policy,
      async () => new Response(bytes),
    );
    await validateOutput(file, 1, await providerNativeOutputContract(file, policy));
    const p = await probe(file),
      video = p.streams.find((s) => s.codec_type === "video")!;
    assert.equal(video.width, 786);
    assert.equal(video.height, 1178);
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await readFile(raw), bytes);
    let counter = 0;
    const rejected = async (
      data: Buffer,
      contract: OutputValidationContract,
      pattern: RegExp = /./,
    ) => {
      const dest = path.join(root, `rejected-${counter++}.mp4`);
      await assert.rejects(
        downloadValidatedOutput(
          "https://approved.example.test/video",
          dest,
          1,
          contract,
          async () => new Response(Uint8Array.from(data)),
        ),
        pattern,
      );
      assert.equal((await readdir(root)).includes(path.basename(dest)), false);
      assert.equal(
        (await readdir(root)).some((n) => n.startsWith(".normalize-")),
        false,
      );
    };
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, fps: 30 } },
      /FRAMERATE/,
    );
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, maxDurationSeconds: 0.5 } },
      /DURATION/,
    );
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, audioCodec: "mp3" } },
      /POLICY/,
    );
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, width: 720, height: 960 } },
      /DIMENSIONS/,
    );
    await rejected(bytes.subarray(0, 32), policy);
    for (const filter of ["scale=788:1178,setsar=1", "setsar=2"]) {
      const bad = path.join(root, `bad-${counter}.mp4`);
      ff([
        "-i",
        raw,
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "ultrafast",
        "-c:a",
        "copy",
        bad,
      ]);
      await rejected(await readFile(bad), policy, /DIMENSIONS|POLICY/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("paid BytePlus 30 FPS source is converted to validated 25 FPS without changing AAC samples",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"sm-provider-fps-"));
 const ff=(args:string[])=>execFileSync("ffmpeg",["-nostdin","-v","error",...args],{
  maxBuffer:4*1024*1024,timeout:30000,
 });
 const hash=(file:string)=>ff(["-i",file,"-map","0:a:0","-c:a","copy",
   "-f","hash","-hash","sha256","-"]).toString("utf8").trim();
 const policy:OutputValidationContract={
  outputHosts:["approved.example.test"],
  output:{width:720,height:1280,fps:25,videoCodec:"h264",
   audioCodec:"aac",durationToleranceSeconds:0.15,maxDurationSeconds:2},
 };
 try{
  for(const rect of ["786x1178","720x1280"]){
   const raw=path.join(root,`source-${rect}.mp4`);
   ff(["-f","lavfi","-i",`color=blue:s=${rect}:r=30:d=1`,
    "-f","lavfi","-i","sine=frequency=440:duration=1",
    "-t","1","-c:v","libx264","-threads","2","-preset","ultrafast",
    "-pix_fmt","yuv420p","-c:a","aac",raw]);
   const expectedHash=hash(raw);
   const bytes=await readFile(raw);
   const dest=path.join(root,`paid-${rect}.mp4`);
   await assert.rejects(validateOutput(raw,1,policy),/FRAMERATE|DIMENSIONS/);
   await downloadValidatedOutput("https://approved.example.test/video",dest,1,policy,
    async()=>new Response(Uint8Array.from(bytes)));
   await validateOutput(dest,1,await providerNativeOutputContract(dest,policy));
   const video=(await probe(dest)).streams.find(x=>x.codec_type==="video")!;
   assert.equal(video.width,Number(rect.split("x")[0]));
   assert.equal(video.height,Number(rect.split("x")[1]));
   assert.equal(video.avg_frame_rate,"25/1");
   assert.equal(hash(dest),expectedHash);
   assert.deepEqual(await readFile(raw),bytes);
  }
 }finally{await rm(root,{recursive:true,force:true})}
});

test("BytePlus 786x1178 30fps source keeps portrait shape even when checkout requested landscape",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"sm-provider-landscape-"));
 const ff=(args:string[])=>execFileSync("ffmpeg",["-nostdin","-v","error",...args],{timeout:30000,maxBuffer:4*1024*1024});
 const hash=(file:string)=>ff(["-i",file,"-map","0:a:0","-c:a","copy","-f","hash","-hash","sha256","-"]).toString().trim();
 const policy:OutputValidationContract={outputHosts:["approved.example.test"],
  output:{width:1280,height:720,fps:25,videoCodec:"h264",audioCodec:"aac",
   durationToleranceSeconds:0.15,maxDurationSeconds:2}};
 try{
  const source=path.join(root,"source.mp4"),dest=path.join(root,"landscape.mp4");
  ff(["-f","lavfi","-i","color=blue:s=786x1178:r=30:d=1","-f","lavfi","-i",
   "sine=frequency=440:duration=1","-t","1","-c:v","libx264","-threads","2",
   "-preset","ultrafast","-pix_fmt","yuv420p","-c:a","aac",source]);
  const original=await readFile(source),audio=hash(source);
  await downloadValidatedOutput("https://approved.example.test/video",dest,1,policy,
   async()=>new Response(Uint8Array.from(original)));
  await validateOutput(dest,1,policy);
  const video=(await probe(dest)).streams.find(x=>x.codec_type==="video")!;
  assert.equal(video.width,786);
  assert.equal(video.height,1178);
  assert.equal(video.avg_frame_rate,"25/1");
  assert.equal(hash(dest),audio);
  assert.deepEqual(await readFile(source),original);
 }finally{await rm(root,{recursive:true,force:true})}
});

test("observed BytePlus 960x960 source stays square regardless of requested portrait or landscape",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"sm-provider-square-"));
 const ff=(args:string[])=>execFileSync("ffmpeg",["-nostdin","-v","error",...args],{timeout:30000,maxBuffer:4*1024*1024});
 const hash=(file:string)=>ff(["-i",file,"-map","0:a:0","-c:a","copy","-f","hash","-hash","sha256","-"]).toString().trim();
 try{
  const source=path.join(root,"square.mp4");
  ff(["-f","lavfi","-i","color=red:s=960x960:r=30:d=1",
   "-f","lavfi","-i","sine=frequency=440:duration=1",
   "-t","1","-c:v","libx264","-threads","2","-preset","ultrafast",
   "-pix_fmt","yuv420p","-c:a","aac",source]);
  const bytes=await readFile(source),sourceHash=hash(source);
  for(const [width,height] of [[720,1280],[1280,720]]){
   const contract:OutputValidationContract={
    outputHosts:["approved.example.test"],
    output:{width,height,fps:25,videoCodec:"h264",audioCodec:"aac",
     durationToleranceSeconds:0.15,maxDurationSeconds:2},
   };
   const dest=path.join(root,`delivery-${width}x${height}.mp4`);
   await assert.rejects(validateOutput(source,1,contract),/DIMENSIONS/);
   await downloadValidatedOutput("https://approved.example.test/video",dest,1,contract,
    async()=>new Response(Uint8Array.from(bytes)));
   await validateOutput(dest,1,await providerNativeOutputContract(dest,contract));
   const video=(await probe(dest)).streams.find(x=>x.codec_type==="video")!;
   assert.equal(video.width,960);
   assert.equal(video.height,960);
   assert.equal(video.avg_frame_rate,"25/1");
   assert.equal(hash(dest),sourceHash);
  }
  assert.deepEqual(await readFile(source),bytes);
  const other:OutputValidationContract={outputHosts:["approved.example.test"],
   output:{width:720,height:960,fps:25,videoCodec:"h264",audioCodec:"aac",
    durationToleranceSeconds:0.15,maxDurationSeconds:2}};
  await assert.rejects(downloadValidatedOutput("https://approved.example.test/video",
   path.join(root,"invalid.mp4"),1,other,async()=>new Response(Uint8Array.from(bytes))),
   /DIMENSIONS/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test("checkout selection never flips provider-native 720p orientation",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"sm-paid-orientation-"));
 const ff=(args:string[])=>execFileSync("ffmpeg",["-nostdin","-v","error",...args],{timeout:30000,maxBuffer:4*1024*1024});
 const hash=(file:string)=>ff(["-i",file,"-map","0:a:0","-c:a","copy","-f","hash","-hash","sha256","-"]).toString().trim();
 try{
  for(const [sourceRect,width,height] of [["720x1280",1280,720],["1280x720",720,1280]] as const){
   const source=path.join(root,"source-"+sourceRect+".mp4");
   ff(["-f","lavfi","-i","color=green:s="+sourceRect+":r=25:d=1",
    "-f","lavfi","-i","sine=frequency=440:duration=1","-t","1",
    "-c:v","libx264","-threads","2","-preset","ultrafast",
    "-pix_fmt","yuv420p","-c:a","aac",source]);
   const original=await readFile(source),audio=hash(source);
   const policy:OutputValidationContract={outputHosts:["approved.example.test"],
    output:{width,height,fps:25,videoCodec:"h264",audioCodec:"aac",
     durationToleranceSeconds:0.15,maxDurationSeconds:2}};
   const dest=path.join(root,"delivered-"+sourceRect+".mp4");
   await downloadValidatedOutput("https://approved.example.test/video",dest,1,policy,
    async()=>new Response(Uint8Array.from(original)));
   const video=(await probe(dest)).streams.find(s=>s.codec_type==="video")!;
   assert.equal(video.width,Number(sourceRect.split("x")[0]));
   assert.equal(video.height,Number(sourceRect.split("x")[1]));
   assert.equal(hash(dest),audio);
   assert.deepEqual(await readFile(source),original);
  }
 }finally{await rm(root,{recursive:true,force:true})}
});

test("provider SAR metadata: absent and unknown-square forms can normalize; non-square pixel ratios remain forbidden",()=>{
  for(const sar of [undefined,null,"N/A","0:1","1:1","2:2","100:100"])
    assert.equal(hasNoNonSquarePixelAspect(sar),true,String(sar));
  for(const sar of ["2:1","1:2","3:2","0:2","",false,2,{}, "1:0","1:1:1","999999:999999"])
    assert.equal(hasNoNonSquarePixelAspect(sar),false,String(sar));
});
