import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("global menu contains exactly the four clear destinations", () => {
  const source = read("components/global-menu.tsx");
  const links = [...source.matchAll(/\{ href: "(\/[^"]+)", label: "([^"]+)" \}/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(links, [
    ["/videos", "Videos"],
    ["/help", "Help"],
    ["/legal", "Legals"],
    ["/contact", "Contact"],
  ]);
});

test("pricing is accessible from the account menu, not the general navigation", () => {
  const menu = read("components/global-menu.tsx");
  const accountMenu = read("components/header-account-menu.tsx");
  const accountPanel = read("components/account-panel.tsx");
  assert.doesNotMatch(menu, /\/plans|Pricing/);
  assert.match(accountMenu, /<Link href="\/plans"/);
  assert.match(accountMenu, />Pricing<\/Link>/);
  assert.doesNotMatch(accountPanel, /href="\/plans"/);
});

test("legal topics retain privacy, consumer and AI policies", () => {
  const legal = read("components/legal-policies.tsx");
  for (const label of ["Legal & privacy", "Terms & consumer rights", "AI & media rights"]) {
    assert.ok(legal.includes(label), `missing topic: ${label}`);
  }
  for (const route of ["/privacy", "/cookies", "/terms", "/withdrawal", "/rights", "/ai-transparency"]) {
    assert.ok(legal.includes(`href: "${route}"`), `missing legal route: ${route}`);
  }
  assert.match(legal, /href: "#imprint"/);
});

test("homepage navigation dropdown stays outside isolated video viewport and above moving clips",()=>{
 const page=read("components/immersive-home.tsx");
 const styles=read("app/(site)/site-navigation.css");
 const header=page.indexOf('<SiteHeader className="sm-immersive-header"/>');
 const viewport=page.indexOf('<div ref={firstScreen}');
 assert.ok(header>=0&&viewport>=0&&header<viewport,"Header must precede clipped hero viewport");
 assert.match(styles,/\.sm-immersive-home>\.sm-immersive-header\s*\{/);
 assert.match(styles,/\.sm-site-header \.sm-header-actions>\.sm-global-menu>\.sm-global-menu-list\s*\{/);
 assert.match(styles,/background:#181427!important/);
 assert.match(styles,/position:fixed!important/);
});


test("Experimental Projects requires verified customer rollout or CMS Super Admin across page/API/menu",()=>{
 const auth=read("lib/music-video/auth.ts");
 const menu=read("components/global-menu.tsx");
 const page=read("app/(site)/projects/page.tsx");
 const detail=read("app/(site)/projects/[id]/page.tsx");
 const api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.match(auth,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(auth,/const id=store\.session\(customerToken\)/);
 assert.match(menu,/setMusicEnabled\(false\)/);
 assert.match(menu,/current===serial/);
 assert.match(auth,/CMS_ENABLED!=="true"/);
 assert.match(auth,/MUSIC_VIDEO_CUSTOMER_ENABLED==="true"&&projectR2Enabled\(\)&&store\.emailVerified\(id\)/);
 assert.match(menu,/fetch\("\/api\/music-video"/);
 assert.doesNotMatch(menu,/auth\?\.authenticated&&auth\.kind==="customer"|staffRole==="super-admin"/);
 assert.match(menu,/musicEnabled&&<Link href="\/projects"/);
 assert.match(menu,/sm-projects-experimental-tag">Experimental/);
 assert.match(read("components/music-projects-client.tsx"),/Experimental · In development/);
 assert.match(read("components/music-video-editor.tsx"),/Experimental · In development/);
 for(const s of [page,detail,api])assert.match(s,/musicPrincipal\(/);
 assert.match(api,/if\(!owner\)throw new MusicError\("Music Video Builder access denied\.",403\)/);
});

test("Projects offers owned completed Lip Sync insertion and separate user video uploads",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes("Insert Lip Sync"));
 assert.ok(editor.includes("Upload video"));
 assert.ok(editor.includes('await ensureSession()'));
 assert.ok(editor.includes('addClip(a,track,source.sourceStartMs)'));
 assert.ok(editor.includes('await load();setLibraryOpen(true);setFilter("All");setSearch("")'));
 assert.ok(!editor.includes("if(track!==null)addClip(result.asset,track,playhead)"));
 assert.ok(editor.includes('filter==="Uploads"&&a.kind==="imported"'));
 assert.ok(api.includes('section==="lip-sync"'));
 assert.ok(api.includes('logged?.owner!=="cms-staff-"+owner.slice(6)'));
 assert.ok(api.includes('service.list(mediaOwner).filter(p=>p.outputReady&&!p.hidden)'));
 assert.ok(api.includes('service.trashedAt(ref,mediaOwner)!==null'));
 assert.ok(api.includes('await service.output(ref,mediaOwner)'));
 assert.ok(api.includes('if(!media.streams.some(v=>v.codec_type==="video"))'));
});

test("song trimming is millisecond precise, validated and non-destructive",async()=>{
 const {parseSongTime,validSongRange,moveSongEdge}=await import("../lib/music-video/song-range.ts");
 assert.equal(parseSongTime("00:08.918"),8918);
 assert.equal(parseSongTime("8.918"),8918);
 assert.equal(parseSongTime("01:02.003"),62003);
 assert.equal(parseSongTime("1,5"),1500);
 assert.equal(parseSongTime("00:60.000"),null);
 assert.equal(parseSongTime("8.9182"),null);
 assert.equal(validSongRange(8918,20000,30000),true);
 assert.equal(validSongRange(8918,9000,30000),false);
 assert.equal(validSongRange(0,30001,30000),false);
 assert.equal(validSongRange("0",30000,30000),false);
 assert.deepEqual(moveSongEdge({startMs:0,endMs:30000},"start",8918,30000),{startMs:8918,endMs:30000});
 assert.deepEqual(moveSongEdge({startMs:8918,endMs:30000},"end",0,30000),{startMs:8918,endMs:9018});
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),core=read("lib/music-video/core.ts");
 assert.ok(editor.includes("dragSongEdge(e,edge)"));
 assert.ok(editor.includes('field==="start"?(parts?partStartText:startText)'));
 assert.ok(editor.includes("apply(moved,true,next)"));
 assert.ok(editor.includes("makeFrameTimeline(previewClips,songRange,songParts,project?.songRemoved?{...trackMutes,song:true}:trackMutes)"));
 assert.ok(api.includes("body.songStartMs,body.songEndMs"));
 assert.ok(core.includes("song_start_ms=?,song_end_ms=?"));
 assert.ok(core.includes("validateMusicClips(clips,assets,MAX_TIMELINE_MS,position-start)"));
});

test("song placement is independent of source trim and locked video moves atomically",async()=>{
 const {songOffset,songTimelineEnd,validSongPlacement,trimSongPlacement,shiftLockedClips,parseSongTime}=await import("../lib/music-video/song-range.ts");
 const song={startMs:8918,endMs:25000,positionMs:12000};
 assert.equal(songOffset(song),3082);
 assert.equal(songTimelineEnd(song),28082);
 assert.equal(validSongPlacement(song,30000),true);
 assert.equal(validSongPlacement({...song,positionMs:-1},30000),false);
 assert.equal(validSongPlacement({...song,positionMs:7200000},30000),false);
 assert.deepEqual(trimSongPlacement(song,{startMs:10000,endMs:25000}),{startMs:10000,endMs:25000,positionMs:13082});
 assert.equal(parseSongTime("120:00.000"),7200000);
 const locked={syncLocked:true,timelineStartMs:12000,sourceInMs:0,sourceOutMs:5000,track:1};
 const free={syncLocked:false,timelineStartMs:20000,sourceInMs:0,sourceOutMs:5000,track:1};
 assert.deepEqual(shiftLockedClips([locked,free],2000),[{...locked,timelineStartMs:14000},free]);
 assert.equal(shiftLockedClips([locked,free],4000),null);
 assert.equal(shiftLockedClips([locked,free],-13000),null);
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),core=read("lib/music-video/core.ts");
 assert.ok(editor.includes('beginMediaGesture(e,"song",()=>dragSong(e)'));
 assert.ok(editor.includes("songPositionMs:range.positionMs"));
 assert.ok(editor.includes('beginMediaGesture(e,"song-part-"+i,()=>{selectPart(i);dragSong(e);}'));
 assert.ok(editor.includes('shiftLockedClips(initial,position-original.positionMs)'));
 assert.ok(editor.includes('commitSongRange(original,position)'));
 assert.ok(!editor.includes('positionText'));
 assert.ok(editor.includes("songOffset(next)-songOffset(original)"));
 assert.ok(api.includes("body.songPositionMs"));
 assert.ok(core.includes("song_position_ms=?"));
 assert.ok(core.includes("a.sourceStartMs+c.sourceInMs+offset"));
});

test("video start time supports exact song-relative placement and collision protection",async()=>{
 const {songTimeToTimeline,timelineToSongTime,parseRelativeSongTime,positionVideoClip}=await import("../lib/music-video/song-range.ts");
 const song={startMs:2000,endMs:25000,positionMs:5000};
 assert.equal(songTimeToTimeline(8918,song),11918);
 assert.equal(timelineToSongTime(11918,song),8918);
 assert.equal(parseRelativeSongTime("-00:02.100"),-2100);
 assert.equal(parseRelativeSongTime("00:08.918"),8918);
 const clip={id:"a",track:1,timelineStartMs:0,sourceInMs:1000,sourceOutMs:4000,syncLocked:false};
 const blocker={...clip,id:"b",timelineStartMs:15000};
 const otherTrack={...blocker,id:"c",track:2,timelineStartMs:11918};
 assert.deepEqual(positionVideoClip([clip,blocker,otherTrack],clip,11918),{status:"ok",clip:{...clip,timelineStartMs:11918}});
 assert.equal(positionVideoClip([clip,blocker],clip,12001).status,"collision");
 assert.equal(positionVideoClip([clip,blocker],clip,12000).status,"ok");
 assert.equal(positionVideoClip([clip,blocker],clip,18000).status,"ok");
 assert.equal(positionVideoClip([clip],clip,-1).status,"bounds");
 assert.equal(positionVideoClip([clip],clip,7200000).status,"bounds");
 assert.equal(positionVideoClip([clip],{...clip,syncLocked:true},8918).status,"locked");
 assert.equal(positionVideoClip([clip],{...clip,syncLocked:true},0).status,"ok");
 const editor=read("components/music-video-editor.tsx");
 assert.ok(!editor.includes('submitClipTime("song")'));
 assert.ok(editor.includes("positionVideoClip(latest.current,current,position)"));
 assert.ok(editor.includes("moveSelectedClip(ms)"));
 assert.ok(editor.includes("Restore Lip Sync"));
 assert.ok(editor.includes("resetClipToSourceStart(latest.current,current"));
 assert.ok(editor.includes("apply(latest.current.map(c=>c.id===current.id?candidate:c))"));
});

test("video trim and track transfer preserve media and synchronization",async()=>{
 const {trimVideoClip,transferVideoClip}=await import("../lib/music-video/song-range.ts");
 const clip={id:"a",track:1,timelineStartMs:8918,sourceInMs:1000,sourceOutMs:5000,syncLocked:true};
 const prev={...clip,id:"b",timelineStartMs:7000,sourceInMs:0,sourceOutMs:1500};
 const next={...clip,id:"c",timelineStartMs:14000,sourceInMs:0,sourceOutMs:2000};
 assert.deepEqual(trimVideoClip([clip],clip,"start",918,6000),{...clip,sourceInMs:1918,timelineStartMs:9836});
 assert.deepEqual(trimVideoClip([clip,prev],clip,"start",-1000,6000),{...clip,sourceInMs:582,timelineStartMs:8500});
 assert.deepEqual(trimVideoClip([clip,next],clip,"end",3000,6000),{...clip,sourceOutMs:6000});
 assert.deepEqual(trimVideoClip([clip],clip,"end",-9000,6000),{...clip,sourceOutMs:1100});
 assert.deepEqual(transferVideoClip([clip],clip,2,12000),{status:"ok",clip:{...clip,track:2}});
 assert.equal(transferVideoClip([clip,{...next,track:2,timelineStartMs:10000}],clip,2,8918).status,"collision");
 assert.deepEqual(transferVideoClip([clip],{...clip,syncLocked:false},2,12000),{status:"ok",clip:{...clip,syncLocked:false,track:2,timelineStartMs:12000}});
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes("videoLanes.current[t]?.getBoundingClientRect()"));
 assert.ok(editor.includes("trimVideoClip(startClips,initial,edge,delta,sourceLimit(initial,asset),timelineLimit)"));
 assert.ok(editor.includes("transferVideoClip(startClips,initial,track,position)"));
 assert.ok(!editor.includes("onClick={switchVideoTrack}"));
 assert.ok(!editor.includes("onClick={toggleLock}"));
 assert.ok(editor.includes('aria-label="Delete selection"'));
 assert.ok(editor.includes('document.addEventListener("pointercancel",cancel)'));
 assert.ok(!editor.includes("draggable={!c.syncLocked}"));
});

test("draggable playhead cuts on exact timeline milliseconds without breaking sync",async()=>{
 const {trimSongAtPlayhead,splitVideoAtPlayhead,snapPlayhead,songOffset}=await import("../lib/music-video/song-range.ts");
 const song={startMs:2000,endMs:25000,positionMs:5000};
 const left=trimSongAtPlayhead(song,11918,"end"),right=trimSongAtPlayhead(song,11918,"start");
 assert.deepEqual(left,{...song,endMs:8918});
 assert.deepEqual(right,{...song,startMs:8918,positionMs:11918});
 assert.equal(songOffset(right!),songOffset(song));
 assert.equal(trimSongAtPlayhead(song,4999,"start"),null);
 assert.equal(trimSongAtPlayhead(song,28000,"end"),null);
 const clip={id:"a",track:1,timelineStartMs:8918,sourceInMs:1000,sourceOutMs:6000,syncLocked:true};
 const parts=splitVideoAtPlayhead(clip,10000,"b");
 assert.deepEqual(parts,[{...clip,sourceOutMs:2082},{...clip,id:"b",timelineStartMs:10000,sourceInMs:2082}]);
 assert.equal(splitVideoAtPlayhead(clip,8920,"b"),null);
 assert.equal(snapPlayhead(8900,20000,[8918],100),8918);
 assert.equal(snapPlayhead(8900,20000,[],100),8900);
 assert.equal(snapPlayhead(-100,20000,[],100),0);
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes("onPointerDown={e=>scrubMarker(e,true)}"));
 assert.ok(editor.includes("onPointerMove={updateMarker}"));
 assert.ok(editor.includes("e.currentTarget.setPointerCapture(e.pointerId)"));
 assert.ok(editor.includes("splitVideoAtPlayhead(current,playheadRef.current,uuid())"));
 assert.ok(!editor.includes("Trim start at playhead"));
 assert.ok(!editor.includes("Trim end at playhead"));
 assert.ok(editor.includes("onClick={songSelected?splitSong:split}"));
 assert.ok(editor.includes('muteButton("song","song")'));
 const songLaneLabel=editor.split("\n").find(line=>line.includes('className="mv-label mv-audio-label mv-track-origin"'));
 assert.ok(songLaneLabel&&!songLaneLabel.includes("Scissors"));
});

test("project player progress shares the exact timeline position with its clock and playhead",async()=>{
 const {timelineProgress}=await import("../lib/music-video/song-range.ts");
 assert.deepEqual(timelineProgress(0,90333),{positionMs:0,percent:0});
 assert.deepEqual(timelineProgress(15000,30000),{positionMs:15000,percent:50});
 assert.deepEqual(timelineProgress(90333,90333),{positionMs:90333,percent:100});
 assert.deepEqual(timelineProgress(100000,90333),{positionMs:90333,percent:100});
 assert.deepEqual(timelineProgress(-10,90333),{positionMs:0,percent:0});
 assert.deepEqual(timelineProgress(1000,0),{positionMs:0,percent:0});
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes("const progress=timelineProgress(playhead,timelineEnd)"));
 assert.ok(editor.includes("time(progress.positionMs,true)"));
 assert.ok(editor.includes("value={progress.positionMs}"));
 assert.ok(editor.includes('width:progress.percent+"%"'));
 assert.ok(editor.includes("left:progress.positionMs/1000*zoom"));
 assert.ok(css.includes("input.mv-progress[type=range]"));
 assert.ok(css.includes("padding:0!important"));
});

test("exact video end and hold-to-edit preserve the source timing and scroll intent",async()=>{
 const {setVideoEnd,mediaPanAxis,MEDIA_HOLD_MS}=await import("../lib/music-video/song-range.ts");
 const clip={id:"a",track:1,timelineStartMs:8918,sourceInMs:1000,sourceOutMs:6000,syncLocked:true};
 const next={...clip,id:"b",timelineStartMs:15000};
 assert.deepEqual(setVideoEnd([clip],clip,12000,9000),{...clip,sourceOutMs:4082});
 assert.equal(setVideoEnd([clip,next],clip,15001,9000),null);
 assert.equal(setVideoEnd([clip],clip,18000,9000),null);
 assert.equal(setVideoEnd([clip],clip,8918,9000),null);
 assert.equal(mediaPanAxis(4,3),null);
 assert.equal(mediaPanAxis(20,3),"x");
 assert.equal(mediaPanAxis(3,-20),"y");
 assert.equal(MEDIA_HOLD_MS,350);
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes("setVideoEnd(latest.current,current,end,sourceLimit(current,selectedAsset))"));
 assert.ok(editor.includes('ariaLabel="Video end time on timeline"'));
 assert.ok(editor.includes("scroller.scrollLeft=startScroll-dx"));
 assert.ok(editor.includes('beginMediaGesture(e,c.id,()=>movePointer(e,c,"move")'));
 assert.ok(editor.includes('beginMediaGesture(e,"song",()=>dragSong(e)'));
 assert.ok(editor.includes('track===1?"Lip-Sync":"B-Roll"'));
 assert.ok(editor.includes('track===1?<Mic size={18}/>:<Video size={18}/>'));
 assert.ok(editor.includes('<Music2 size={18}/><strong>Song</strong>'));
});

test("library role is distinct from immutable media provenance and source timing",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),core=read("lib/music-video/core.ts");
 assert.ok(core.includes('export type MediaRole = "lip-sync" | "b-roll"'));
 assert.ok(core.includes('role:r.role??(r.kind==="lip-sync"?"lip-sync":"b-roll")'));
 assert.ok(core.includes('UPDATE music_assets SET role=? WHERE id=? AND project_id=?'));
 assert.ok(core.includes('UPDATE music_clips SET sync_locked=0 WHERE project_id=? AND asset_id=?'));
 assert.ok(core.includes('if(a.role!=="lip-sync"||a.sourceStartMs===null'));
 assert.ok(api.includes('setMusicAssetRole(id,owner,assetId,body.role,body.revision)'));
 assert.ok(api.includes('sourceStartMs:from,sourceEndMs:to'));
 assert.ok(editor.includes('changeAssetRole(a,"lip-sync")'));
 assert.ok(editor.includes('changeAssetRole(a,"b-roll")'));
 assert.ok(editor.includes('filter==="B-Roll"&&a.role==="b-roll"'));
 assert.ok(editor.includes('filter==="Uploads"&&a.kind==="imported"'));
 assert.ok(editor.includes('const locked=!project?.songRemoved&&asset.role==="lip-sync"&&asset.sourceStartMs'));
 assert.ok(editor.includes('a.role==="lip-sync"?1:2'));
 assert.ok(editor.includes('persistAssetRole(existing,"lip-sync")'));
});

test("timeline zoom is visibly separate from playback progress",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('role="group" aria-label="Timeline zoom"'));
 assert.ok(editor.includes('aria-label="Zoom out timeline"'));
 assert.ok(editor.includes('aria-label="Zoom in timeline"'));
 assert.ok(editor.includes('zoomBy(1/1.35)'));
 assert.ok(editor.includes('zoomBy(1.35)'));
 assert.ok(!editor.includes('aria-label="Timeline zoom" type="range"'));
 assert.ok(editor.includes('value={progress.positionMs}'));
 assert.ok(css.includes(".mv-timeline-zoom .mv-zoom-buttons"));
});

test("timeline uses full width and media is added from the library",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('const songSelected=selected==="song"'));
 assert.ok(editor.includes('function selectSong(){if(project?.songRemoved)return;setSelected("song");setInspectorOpen(true);}'));
 assert.ok(editor.includes('beginMediaGesture(e,"song",()=>dragSong(e),selectSong)'));
 assert.ok(editor.includes('aria-label="Select song" aria-pressed={songSelected}'));
 assert.ok(editor.includes('!songSelected&&selectedClip&&selectedAsset?<form'));
 assert.ok(editor.includes('</form>:\n      <form className="mv-song-trim mv-song-position"'));
 const scroll=editor.indexOf('<div className="mv-scroll"');
 assert.ok(scroll>=0);
 assert.ok(!editor.includes('className="mv-track-adds"'));
 assert.ok(!css.includes('.mv-track-adds'));
 const library=editor.indexOf('className="mv-library-tools"');
 assert.ok(library>scroll);
 assert.ok(editor.indexOf('onClick={()=>void openLipSync(1)}',library)>library);
 assert.ok(editor.indexOf('onClick={()=>fileInput.current?.click()}',library)>library);
 assert.ok(css.includes('.mv-song-block.is-selected'));
});

test("project header stays on one compact line with readable status and export",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('className="mv-project-name-button"'));
 assert.ok(editor.includes('<span>{project!.name}</span>'));
 assert.ok(editor.includes('className="mv-primary mv-export-button"'));
 assert.ok(css.includes('.mv-top{flex-wrap:nowrap}'));
 assert.ok(css.includes('.mv-top .mv-export-soon{display:none}'));
 assert.ok(css.includes('.mv-top .mv-top-actions{flex:none}'));
});

test("song splits preserve absolute time and leave silence for removed intervals",async()=>{
 const {splitSongPart,songPartAt,songPartsEnd,validSongParts}=await import("../lib/music-video/song-range.ts");
 const range={startMs:58467,endMs:148800,positionMs:0};
 const parts=splitSongPart(range,null,2804);
 assert.deepEqual(parts,[{startMs:58467,endMs:61271},{startMs:61271,endMs:148800}]);
 assert.equal(songPartsEnd(range,parts),90333);
 assert.equal(songPartAt(range,parts,2804)?.startMs,61271);
 assert.equal(songPartAt(range,[parts![1]],1000),null);
 assert.equal(validSongParts([{startMs:58467,endMs:61271},{startMs:60000,endMs:70000}],range),false);
 const editor=read("components/music-video-editor.tsx"),core=read("lib/music-video/core.ts");
 assert.ok(core.includes("song_parts_json=?"));
 assert.ok(editor.includes("songParts:parts"));
 assert.ok(editor.includes("onClick={songSelected?splitSong:split}"));
 assert.ok(read("lib/music-video/frame-timeline.ts").includes("effectiveSongParts(range,parts)"));
});
test("one-click export uses top-track render spans and owner-scoped download",async()=>{
 const {videoRenderSpans}=await import("../lib/music-video/export.ts");
 const a={id:"a",assetId:"a",track:1 as const,timelineStartMs:0,sourceInMs:1000,sourceOutMs:5000,syncLocked:false};
 const b={...a,id:"b",assetId:"b",track:2 as const,timelineStartMs:1000,sourceInMs:0,sourceOutMs:1000};
 const spans=videoRenderSpans([a,b],5000);
 assert.deepEqual(spans.map(s=>[s.startFrame,s.endFrame,s.clip?.id??null,s.sourceMs]),[[0,30,"a",1000],[30,60,"b",0],[60,120,"a",3000],[120,150,null,0]]);
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes("onClick={()=>void exportMp4()}"));
 assert.ok(editor.includes("await saveNow()"));
 assert.ok(api.includes("musicExportFile(owner,id,assetId)"));
 assert.ok(api.includes("startMusicExport(owner,detail.project,detail.clips,files,songFile,async()=>{try{await scratch.close();}finally{releaseAdmission?.();}})"));
 assert.ok(api.includes("attachment; filename="));
 assert.ok(editor.includes('hidden={!inspectorOpen}'));
});

test("a split without a removed interval plays seamlessly",async()=>{
 const {continuousSongParts}=await import("../lib/music-video/song-range.ts");
 const range={startMs:1000,endMs:10000,positionMs:0};
 assert.deepEqual(continuousSongParts(range,[{startMs:1000,endMs:3000},{startMs:3000,endMs:4000},{startMs:5000,endMs:10000}]),[{startMs:1000,endMs:4000},{startMs:5000,endMs:10000}]);
});

test("MP4 export automatically chooses 720p or 1080p from visible source dimensions",async()=>{
 const {chooseExportResolution}=await import("../lib/music-video/export.ts");
 const hd={width:1280,height:720},full={width:1920,height:1080};
 assert.deepEqual(chooseExportResolution([{width:640,height:480}]),hd);
 assert.deepEqual(chooseExportResolution([hd,{width:720,height:1280}]),hd);
 assert.deepEqual(chooseExportResolution([hd,full]),full);
 assert.deepEqual(chooseExportResolution([{width:1080,height:1920}]),full);
 assert.deepEqual(chooseExportResolution([{width:3840,height:2160}]),full);
 assert.deepEqual(chooseExportResolution([{width:1600,height:900}]),full);
 assert.throws(()=>chooseExportResolution([{width:0,height:720}]));
 assert.throws(()=>chooseExportResolution([]));
 const renderer=read("lib/music-video/export.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(renderer.includes("inspectExportResolution(spans,files,project.aspectRatio)"));
 assert.ok(renderer.includes("stream=width,height"));
 assert.ok(renderer.includes('scale="+width+":"+height+'));
 assert.ok(renderer.includes('color=c=black:s="+width+"x"+height'));
 assert.ok(editor.includes("exportJob.resolution.height"));
});

test("each timeline lane persists audio mute and the cut button follows selection",()=>{
 const editor=read("components/music-video-editor.tsx"),core=read("lib/music-video/core.ts"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),renderer=read("lib/music-video/export.ts"),css=read("components/music-video.css");
 assert.ok(core.includes("track_mute_mask INTEGER NOT NULL DEFAULT 3"));
 assert.ok(core.includes("track_mute_mask=?"));
 assert.ok(api.includes("body.trackMutes"));
 assert.ok(editor.includes("trackMutes:mutes"));
 assert.ok(editor.includes('muteButton("song","song")'));
 assert.ok(editor.includes("muteButton(track,"));
 assert.ok(editor.includes("makeFrameTimeline(previewClips,songRange,songParts,project?.songRemoved?{...trackMutes,song:true}:trackMutes)"));
 assert.ok(editor.includes("onClick={songSelected?splitSong:split}"));
 assert.ok(!editor.includes("> Split video</button>"));
 assert.ok(!editor.includes("> Split song</button>"));
 assert.ok(renderer.includes("if(mutes[track]||!clips.some"));
 assert.ok(renderer.includes("if(!mutes.song)mixLabels.push"));
 assert.ok(css.includes("grid-template-columns:minmax(0,1fr) auto auto"));
});
test("video lane audio includes covered clips and silence between clips",async()=>{
 const {trackAudioSpans}=await import("../lib/music-video/export.ts");
 const a={id:"a",assetId:"a",track:1 as const,timelineStartMs:1000,sourceInMs:500,sourceOutMs:2500,syncLocked:false};
 const b={...a,id:"b",assetId:"b",track:2 as const,timelineStartMs:0,sourceInMs:0,sourceOutMs:4000};
 assert.deepEqual(trackAudioSpans([a,b],1,4000).map(s=>[s.clip?.id??null,s.startMs,s.durationMs]),[[null,0,1000],["a",1000,2000],[null,3000,1000]]);
 assert.deepEqual(trackAudioSpans([a,b],2,4000).map(s=>[s.clip?.id??null,s.startMs,s.durationMs]),[["b",0,4000]]);
});

test("muted song uses one native clip clock without duplicate visible audio",async()=>{
 const {previewMediaPlan}=await import("../lib/music-video/song-range.ts");
 const a={id:"a",track:1 as const,timelineStartMs:0,sourceInMs:500,sourceOutMs:4500};
 const b={id:"b",track:2 as const,timelineStartMs:1000,sourceInMs:0,sourceOutMs:2000};
 const c={...a,id:"c",timelineStartMs:5000};
 let plan=previewMediaPlan([a,b,c],0,{1:false,2:true});
 assert.equal(plan.visible,a);assert.equal(plan.clock,a);assert.equal(plan.audio1,undefined);assert.equal(plan.nextBoundaryMs,1000);
 plan=previewMediaPlan([a,b,c],1000,{1:false,2:true});
 assert.equal(plan.visible,b);assert.equal(plan.clock,a);assert.equal(plan.audio1,a);assert.equal(plan.audio2,undefined);
 plan=previewMediaPlan([a,b,c],1000,{1:false,2:false});
 assert.equal(plan.clock,b);assert.equal(plan.audio1,a);assert.equal(plan.audio2,undefined);
 plan=previewMediaPlan([a,b,c],1000,{1:true,2:true});
 assert.equal(plan.clock,b);assert.equal(plan.audio1,undefined);
 plan=previewMediaPlan([a,b,c],4000,{1:false,2:false});
 assert.equal(plan.clock,undefined);assert.equal(plan.nextBoundaryMs,5000);
 const engine=read("lib/music-video/frame-preview-engine.ts"),timeline=read("lib/music-video/frame-timeline.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(timeline.includes("if(!mutes.song)"));
 assert.ok(timeline.includes("if(!mutes[c.track]"));
 assert.ok(engine.includes("node.connect(this.gain!)"));
 assert.ok(!editor.includes("<audio"));
});
test("desktop mouse starts editing immediately; touch retains long-press scrolling",()=>{
 const editor=read("components/music-video-editor.tsx");
 const gesture=editor.slice(editor.indexOf("function beginMediaGesture("),editor.indexOf("function dragSong(e:"));
 assert.ok(gesture.includes('if(e.pointerType==="mouse"&&allowHold){setArmedMedia(media);onHold();return;}'));
 assert.ok(gesture.indexOf('if(e.pointerType==="mouse"&&allowHold)')<gesture.indexOf("setTimeout("));
 assert.ok(gesture.includes("mediaPanAxis(dx,dy)"));
 assert.ok(gesture.includes("},MEDIA_HOLD_MS)"));
 assert.ok(!gesture.includes("immediate&&"));
});

test("preview and render share exact source time and correct drift without seek storms",async()=>{
 const {clipSourceTimeMs,mediaSyncDecision}=await import("../lib/music-video/song-range.ts");
 const clip={timelineStartMs:2804,sourceInMs:715,sourceOutMs:5000};
 assert.equal(clipSourceTimeMs(clip,2804),715);
 assert.equal(clipSourceTimeMs(clip,3804),1715);
 assert.equal(clipSourceTimeMs(clip,0),715);
 assert.equal(clipSourceTimeMs(clip,9000),5000);
 assert.equal(mediaSyncDecision(1,0.8,true,false,false).seek,true);
 assert.equal(mediaSyncDecision(1,0.94,true,false,false).seek,false);
 assert.ok(mediaSyncDecision(1,0.94,true,false,false).rate>1);
 assert.equal(mediaSyncDecision(1,0.87,true,false,false).seek,true);
 assert.equal(mediaSyncDecision(1,0.998,false,true,true).seek,false);
 assert.equal(mediaSyncDecision(1,0.975,true,false,false).seek,false);
 assert.ok(mediaSyncDecision(1,0.975,true,false,false).rate>1);
 assert.ok(mediaSyncDecision(1,1.025,true,false,false).rate<1);
 assert.equal(mediaSyncDecision(1,0.8,true,false,true).seek,false);
 assert.equal(mediaSyncDecision(1,0.998,false,true,false).seek,true);
 const engine=read("lib/music-video/frame-preview-engine.ts"),timeline=read("lib/music-video/frame-timeline.ts"),editor=read("components/music-video-editor.tsx"),renderer=read("lib/music-video/export.ts"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(renderer.includes("clipSourceTimeMs(clip,at)"));
 assert.ok(api.includes("const inspected=await probe(file)"));
 assert.ok(api.includes("duration=toMs(measured)"));
 assert.ok(!editor.includes("playing?0.24:0.001"));
 assert.ok(timeline.includes("clipSourceTimeMs(span.clip,timelineMs)"));
 assert.ok(engine.includes("frameTarget(timeline,this.position)"));
 const libraryPreviewStart=editor.indexOf('{libraryPreview&&<dialog');
 assert.ok(libraryPreviewStart>=0);
 const libraryPreviewEnd=editor.indexOf('</dialog>}',libraryPreviewStart);
 assert.ok(libraryPreviewEnd>libraryPreviewStart);
 const libraryPreview=editor.slice(libraryPreviewStart,libraryPreviewEnd);
 assert.ok(libraryPreview.includes('<video controls autoPlay playsInline preload="metadata"'));
 assert.ok(![editor.slice(0,libraryPreviewStart),editor.slice(libraryPreviewEnd)].some(part=>part.includes("<video")));
});

test("auto export follows first visible video orientation; explicit format overrides it",async()=>{
 const {chooseExportResolution}=await import("../lib/music-video/export.ts");
 const {firstVisibleVideo,aspectFromDimensions}=await import("../lib/music-video/song-range.ts");
 const portrait={width:720,height:1280},landscape={width:1280,height:720};
 assert.deepEqual(chooseExportResolution([portrait],"auto"),portrait);
 assert.deepEqual(chooseExportResolution([portrait,{width:1920,height:1080}],"auto"),{width:1080,height:1920});
 assert.deepEqual(chooseExportResolution([landscape,portrait],"auto"),landscape);
 assert.deepEqual(chooseExportResolution([portrait],"16:9"),landscape);
 assert.deepEqual(chooseExportResolution([landscape],"9:16"),portrait);
 assert.equal(aspectFromDimensions(portrait),"9:16");
 const lower={id:"lower",track:1,timelineStartMs:10,sourceInMs:0,sourceOutMs:1000};
 const upper={...lower,id:"upper",track:2,timelineStartMs:25};
 assert.equal(firstVisibleVideo([lower,upper])?.id,"upper");
 const editor=read("components/music-video-editor.tsx"),core=read("lib/music-video/core.ts"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(core.includes("aspect_ratio TEXT NOT NULL DEFAULT 'auto'"));
 assert.ok(editor.includes("aspectRatio:ratio"));
 assert.ok(editor.includes("firstVisibleVideo(clips.filter(c=>c.timelineStartMs<timelineEnd))"));
 assert.ok(api.includes("inspectVideoDimensions(files.get(assetId)!)"));
});

test("video inspector groups source start/end before timeline start/end",()=>{
 const editor=read("components/music-video-editor.tsx");
 const start=editor.indexOf('className="mv-video-times"');
 const end=editor.indexOf('<span className="mv-inspector-duration">',start);
 assert.ok(start>=0&&end>start);
 const labels=[...editor.slice(start,end).matchAll(/<InlineTimeField label="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(labels,["Timeline start","Timeline end"]);
 assert.ok(editor.includes("Original song time"));
 assert.ok(editor.includes("Fixed source times from generation · read-only"));
 assert.ok(editor.includes("Manual source time · independent of timeline position"));
 assert.ok(editor.includes("Save source time"));
 assert.ok(editor.includes('readOnly value={selectedAsset.sourceStartMs===null?"Unavailable":time(selectedAsset.sourceStartMs,true)}'));
 assert.ok(editor.includes('readOnly value={selectedAsset.sourceEndMs===null?"Unavailable":time(selectedAsset.sourceEndMs,true)}'));
 assert.ok(editor.includes("Position in this music video project"));
 assert.ok(editor.includes('onConfirm={submitClipTime}'));
 assert.ok(editor.includes('onConfirm={submitClipEnd}'));
});

test("library uses small authenticated cached still thumbnails instead of loading video elements",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes('src={endpoint+id+"/thumbnail/"+a.id}'));
 assert.ok(editor.includes('loading="lazy" decoding="async" draggable={false}'));
 assert.ok(api.includes('if(section==="thumbnail"&&assetId&&validId(assetId)&&req.method==="GET")'));
 assert.ok(api.includes('const asset=musicAsset(id,owner,assetId)'));
 assert.ok(api.includes('scale=320:240:force_original_aspect_ratio=decrease:force_divisible_by=2'));
 assert.ok(api.includes('thumbnailSlots>=2'));
 assert.ok(api.includes('"Cache-Control":"private, no-cache"'));
});

test("song inspector shows actual song name once, playhead cap stays in bounds, and trim handles stay accessible",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),core=read("lib/music-video/core.ts");
 assert.ok(editor.includes('project!.songName||"Unnamed song"'));
 assert.ok(!editor.includes(':"Song trim"}</strong>'));
 assert.ok(!editor.includes('aria-label="Rename song"'));
 assert.ok(!editor.includes('aria-label="Reset splits"'));
 assert.ok(!editor.includes('aria-label="Reset song range"'));
 assert.ok(!editor.includes('aria-label="Remove part"'));
 assert.ok(editor.includes('aria-label={"Rename project "+project!.name}'));
 assert.ok(editor.includes('onClick={songSelected?removeSongPart:deleteClip}'));
 assert.ok(editor.includes('aria-label="Undo"'));
 assert.ok(editor.includes('aria-label="Redo"'));
 assert.ok(core.includes("ADD COLUMN song_name TEXT DEFAULT NULL"));
 assert.ok(api.includes('await originalSongTitle(temp)||cleanSongName(file.name'));
 assert.ok(editor.includes('className="mv-playhead-overlay"'));
 assert.ok(editor.includes("rulerViewport.left+markerViewportX"));
 assert.ok(editor.includes("progress.positionMs/1000*zoom-rulerViewport.scrollLeft"));
 assert.ok(css.includes("transform:translateX(-50%);width:24px"));
 assert.ok(editor.includes("Snap to edges"));
 assert.ok(!editor.includes("Math.max(0,Math.min(pixels-25"));
 assert.ok(editor.includes('aria-label="Trim clip start"'));
 assert.ok(editor.includes('aria-label="Trim clip end"'));
 assert.ok(!editor.includes(">Ⅱ</button>"));
 assert.ok(css.includes("width:min(22px,33%)"));
});

test("project overview reuses first visible clip thumbnail and offers explicit edit action",()=>{
 const client=read("components/music-projects-client.tsx"),core=read("lib/music-video/core.ts");
 assert.ok(client.includes('p.thumbnailAssetId&&<img'));
 assert.ok(client.includes('src={"/api/music-video/"+p.id+"/thumbnail/"+p.thumbnailAssetId}'));
 assert.ok(client.includes('<Link href={"/projects/"+p.id}><Pencil size={14}/> Edit</Link>'));
 assert.ok(core.includes('thumbnailAssetId:firstVisibleVideo'));
});

test("project and library browse toolbars offer search, matching filters, refresh and sorting",()=>{
 const client=read("components/music-projects-client.tsx"),editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 for(const page of [client,editor]){
  assert.ok(page.includes('className="mv-browse-toolbar"'));
  assert.ok(page.includes('className="mv-browse-search"'));
  assert.ok(/className="mv-browse-filter(?: |")/.test(page));
  assert.ok(page.includes("Newest first"));
  assert.ok(page.includes("Oldest first"));
 }
 assert.ok(client.includes('aria-label="Refresh projects"'));
 assert.ok(editor.includes('aria-label="Refresh library"'));
 assert.ok(editor.includes('librarySort==="newest"?b.createdAt-a.createdAt:a.createdAt-b.createdAt'));
 assert.ok(editor.includes('["source","Source Time"]'));assert.ok(editor.includes('className="mv-library-select-menu"'));
 assert.ok(editor.includes("a.sourceStartMs??Infinity"));
 assert.ok(editor.includes("usedAssets.has(a.id)"));
 assert.ok(client.includes("newest?b.updatedAt-a.updatedAt:a.updatedAt-b.updatedAt"));
 assert.ok(editor.includes('aria-label="Project video format"'));
 assert.ok(!editor.includes("<span>Format</span>"));
});

test("project and library menus dismiss on outside clicks and Escape; clip details stay compact",()=>{
 const client=read("components/music-projects-client.tsx"),editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 for(const page of [client,editor]){
  assert.ok(page.includes('document.addEventListener("pointerdown",outside,true)'));
  assert.ok(page.includes('if(!menu.contains(target))menu.open=false'));
  assert.ok(page.includes('event.key!=="Escape"'));
  assert.ok(page.includes('document.removeEventListener("pointerdown",outside,true)'));
 }
 assert.ok(editor.includes('c.showVideoName?<span className="mv-clip-title"><span>{a.name}</span></span>'));
 assert.ok(editor.includes('track===1?<Mic size={18}/>:<Video size={18}/>'));
 assert.ok(!editor.includes("🎤"));
 assert.ok(!editor.includes("🎬"));
 assert.ok(!editor.includes("<small>Drag a clip or handle with the mouse."));
 assert.ok(!editor.includes("<small>Drag with mouse to move all song parts together."));
 assert.equal(editor.split('className="mv-inspector-duration"').length-1,2);
 assert.ok(css.includes(".mv-root.mv-editor .mv-inspector-duration b"));
});

test("library menu fits viewport and downloads the authorized original video",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes('href={endpoint+id+"/assets/"+a.id+"?download=1"} download'));
 assert.ok(editor.includes("window.innerHeight-h-margin"));
 assert.ok(editor.includes('className="mv-library-menu"'));
 assert.ok(css.includes(".mv-root.mv-editor .mv-library{overflow:visible}"));
 assert.ok(css.includes("position:fixed;top:auto;right:auto;left:auto;z-index:1000"));
 assert.ok(api.includes("await exportSources(req,owner,id,musicDetail(id,owner),scratch,[assetId])"));
 assert.ok(api.includes('attachment; filename="'));
});

test("video and song time fields confirm inline and on Enter",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('className="mv-inline-confirm"'));
 assert.ok(editor.includes('if(e.key==="Enter"){e.preventDefault();if(!disabled)onConfirm();}'));
 assert.ok(editor.includes('onConfirm={()=>submitSongField("start")}'));
 assert.ok(editor.includes('onConfirm={()=>submitSongField("end")}'));
 assert.ok(!editor.includes('onConfirm={()=>submitSongField("position")}'));
 assert.ok(!editor.includes('Song group position'));
 assert.ok(!editor.includes('ariaLabel="Song timeline position"'));
 assert.ok(!editor.includes(">Move video</button>"));
 assert.ok(!editor.includes(">Set end</button>"));
 assert.ok(!editor.includes(">Set part</button>"));
 assert.ok(css.includes("padding-right:34px!important"));
});

test("the timeline and export stop at the last retained song part, not the source duration or video end",async()=>{
 const {songPartsEnd}=await import("../lib/music-video/song-range.ts");
 const {videoRenderSpans,trackAudioSpans}=await import("../lib/music-video/export.ts");
 const range={startMs:10000,endMs:40000,positionMs:0};
 const parts=[{startMs:10000,endMs:20000},{startMs:22000,endMs:25000}];
 const duration=songPartsEnd(range,parts);
 assert.equal(duration,15000);
 const clip={id:"a",assetId:"a",track:1 as const,timelineStartMs:0,sourceInMs:500,sourceOutMs:30000,syncLocked:false};
 const outside={...clip,id:"b",timelineStartMs:30000};
 assert.equal(videoRenderSpans([clip,outside],duration).at(-1)?.endFrame,450);
 assert.equal(trackAudioSpans([clip,outside],1,duration)[0].durationMs,15000);
 const editor=read("components/music-video-editor.tsx"),renderer=read("lib/music-video/export.ts");
 assert.ok(editor.includes("const timelineEnd=project?songPartsEnd(songRange,songParts):0"));
 assert.ok(editor.includes("const timelineLimit=timelineEnd"));
 assert.ok(editor.includes("Math.max(usableTimelineWidth,project?Math.max(1,timelineLimit/1000*zoom):640)"));
 assert.ok(editor.includes("timelineFitZoom(timelineLimit,usableTimelineWidth)"));
 assert.ok(!editor.includes('className="mv-song-wave-title"'));
 assert.ok(editor.includes("c.track===track&&c.timelineStartMs<timelineLimit"));
 assert.ok(editor.includes("Math.min(clipEnd(c),timelineLimit)-c.timelineStartMs"));
 assert.ok(editor.includes("if(end>timelineLimit)"));
 assert.ok(editor.includes("Math.min(timelineLimit-(initial.sourceOutMs-initial.sourceInMs)"));
 assert.ok(editor.includes("songTimelineEnd(candidate)<=songPlacementLimit"));
 assert.ok(!editor.includes("Math.max(songPartsEnd("));
 assert.equal(renderer.split("const duration=songPartsEnd(range,project.songParts);").length,3);
});

test("Projects preview throttles React renders, keeps the exact clock and does not decode the whole song on the client",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(read("lib/music-video/frame-preview-engine.ts").includes("now-this.lastPublish>=60"));
 assert.ok(editor.includes("playheadRef.current=ms"));
 assert.ok(read("lib/music-video/frame-preview-engine.ts").includes("this.outputTime()-this.anchorTime"));
 assert.ok(editor.includes('playheadLine.current.style.left=x+"px"'));
 assert.ok(editor.includes("const SongWaveform=memo("));
 assert.ok(editor.includes('endpoint+id+"/waveform"'));
 assert.ok(!editor.includes("decodeAudioData("));
 assert.ok(api.includes('.wave-v2.json'));
 assert.ok(api.includes('extractMediaWaveform(file,durationMs)'));
 assert.ok(api.includes('if(waveJobs.size>=2)'));
 assert.ok(editor.includes('sourceInMs={c.sourceInMs}'));
 assert.ok(editor.includes('sourceInMs={p.startMs}'));
 assert.ok(!editor.includes('Array.from({length:180},()=>0.22)'));
 assert.ok(read("lib/music-video/frame-preview-engine.ts").includes("this.seekVersion"));
 assert.ok(read("lib/music-video/frame-preview-engine.ts").includes("sink.buffers(sourceStart,sourceEnd)"));
});
test("preview proxies are authorized, bounded and do not replace export originals",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),renderer=read("lib/music-video/export.ts");
 assert.ok(api.includes('const project=requireMusicProject(id,owner)'));
 assert.ok(api.includes('const asset=musicAsset(id,owner,assetId)'));
 assert.ok(api.includes('if(durationMs>180000)return false'));
 assert.ok(api.includes('if(previewJobs.size)return false'));
 assert.ok(api.includes('while(old.length>=6)'));
 assert.ok(api.includes('s.size<=previewByteLimit(mobile)'));
 assert.ok(read("lib/music-video/preview-profile.ts").includes('(mobile?64:24)*1024*1024'));
 assert.ok(api.includes('"private, no-cache"'));
 assert.ok(api.includes('"Vary":"Cookie, Authorization"'));
 assert.ok(editor.includes('data-frame-preview="true"'));
 assert.ok(editor.includes('"?mobile=1"'));
 assert.ok(api.includes('startMusicExport(owner,detail.project,detail.clips,files,songFile,async()=>{try{await scratch.close();}finally{releaseAdmission?.();}})'));
 assert.ok(!renderer.includes('preview-v1'));
});

test("mobile editing uses one native clock and never automatically downloads original video",()=>{
 const engine=read("lib/music-video/frame-preview-engine.ts"),timeline=read("lib/music-video/frame-timeline.ts"),editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(!editor.includes('syncMobileSong'));
 assert.ok(!editor.includes('if(incoming)audio.current?.pause()'));
 assert.ok(api.includes('if(mobile)return json({error:"Mobile preview not ready."},409)'));
 const profile=read("lib/music-video/preview-profile.ts");
 assert.ok(profile.includes('mobile?"2200k":"800k"'));
 assert.ok(profile.includes('mobile?"192k":"96k"'));
 assert.ok(profile.includes('["-profile:v","baseline","-level:v","3.1"]'));
 assert.ok(editor.includes('"?mobile=1"'));
 assert.ok(editor.includes('if(data.unsupported)throw Error'));
 assert.ok(engine.includes("maxCacheSize:8*1024*1024"));
 assert.ok(engine.includes("FRAME_CACHE_LIMIT=6"));
 assert.ok(!editor.includes("<audio"));
 const libraryPreviewStart=editor.indexOf('{libraryPreview&&<dialog');
 assert.ok(libraryPreviewStart>=0);
 const libraryPreviewEnd=editor.indexOf('</dialog>}',libraryPreviewStart);
 assert.ok(libraryPreviewEnd>libraryPreviewStart);
 const libraryPreview=editor.slice(libraryPreviewStart,libraryPreviewEnd);
 assert.ok(libraryPreview.includes('<video controls autoPlay playsInline preload="metadata"'));
 assert.ok(![editor.slice(0,libraryPreviewStart),editor.slice(libraryPreviewEnd)].some(part=>part.includes("<video")));
});

test("fractional native playback never publishes the next track before the clock reaches its boundary",async()=>{
 const {previewMediaPlan,publishedPlaybackMs,nativeClipClockStep}=await import("../lib/music-video/song-range.ts");
 const a={id:"lip",track:1 as const,timelineStartMs:0,sourceInMs:0,sourceOutMs:1000};
 const b={id:"overlay",track:2 as const,timelineStartMs:1000,sourceInMs:1500,sourceOutMs:2500};
 const c={...a,id:"lip-return",timelineStartMs:2000};
 const clips=[a,b,c],mutes={1:false,2:true};
 let at=nativeClipClockStep(a,990,0.9997,1000,false);
 assert.equal(previewMediaPlan(clips,at,mutes).visible?.id,"lip");
 assert.equal(publishedPlaybackMs(at),999);
 assert.equal(previewMediaPlan(clips,publishedPlaybackMs(at),mutes).visible?.id,"lip");
 at=nativeClipClockStep(a,at,1,1000,false);
 assert.equal(at,1000);
 assert.equal(previewMediaPlan(clips,publishedPlaybackMs(at),mutes).visible?.id,"overlay");
 assert.equal(nativeClipClockStep(b,at,1.5,2000,false),1000);
 at=nativeClipClockStep(b,1999,2.499,2000,true);
 assert.equal(at,2000);
 assert.equal(previewMediaPlan(clips,publishedPlaybackMs(at),mutes).visible?.id,"lip-return");
 // Overlap: the top lane takes over exactly at its first frame, and the lower returns.
 const lower={...a,sourceOutMs:3000};
 assert.equal(nativeClipClockStep(lower,999,1.05,1000,false),1000);
 assert.equal(previewMediaPlan([lower,b],1000,mutes).visible?.id,"overlay");
 assert.equal(previewMediaPlan([lower,b],2000,mutes).visible?.id,"lip");
 const engine=read("lib/music-video/frame-preview-engine.ts"),timeline=read("lib/music-video/frame-timeline.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(engine.includes("Math.max(this.position,desired)"));
 assert.ok(engine.includes("frameTarget(timeline,this.position)"));
});


test("next preview decoder seeks to exact picture transition, including covered lower track",async()=>{
 const {nextVisibleClipTransition,clipSourceTimeMs}=await import("../lib/music-video/song-range.ts");
 const base={id:"base",track:1 as const,timelineStartMs:0,sourceInMs:1000,sourceOutMs:11000};
 const overlay={id:"overlay",track:2 as const,timelineStartMs:3000,sourceInMs:500,sourceOutMs:2500};
 const next={id:"next",track:1 as const,timelineStartMs:12000,sourceInMs:800,sourceOutMs:2800};
 const clips=[base,overlay,next],boundaries=[0,3000,5000,10000,12000,14000],mutes={1:false,2:false};
 assert.deepEqual(nextVisibleClipTransition(clips,1000,boundaries,mutes),{clip:overlay,atMs:3000});
 const resumed=nextVisibleClipTransition(clips,4000,boundaries,mutes)!;
 assert.equal(resumed.clip.id,"base");assert.equal(resumed.atMs,5000);assert.equal(clipSourceTimeMs(resumed.clip,resumed.atMs),6000);
 assert.deepEqual(nextVisibleClipTransition(clips,9000,boundaries,mutes),{clip:next,atMs:12000});
 assert.equal(nextVisibleClipTransition(clips,13000,boundaries,mutes),undefined);
});


test("native Projects clock advances EOF instead of replaying the previous clip",async()=>{
 const {nativeClockAction,nativeClipClockStep,previewMediaPlan}=await import("../lib/music-video/song-range.ts");
 const first={id:"first",track:1 as const,timelineStartMs:0,sourceInMs:0,sourceOutMs:1000};
 const second={id:"second",track:1 as const,timelineStartMs:1000,sourceInMs:200,sourceOutMs:1200};
 const ended={ended:true,paused:true,seeking:false,readyState:2};
 assert.equal(nativeClockAction(ended,true),"ended");
 assert.equal(nativeClockAction({...ended,seeking:true},true),"wait");
 assert.equal(nativeClockAction(ended,false),"wait");
 const at=nativeClipClockStep(first,970,0.97,1000,true);
 assert.equal(at,1000);assert.equal(previewMediaPlan([first,second],at,{1:true,2:true}).visible?.id,"second");
 assert.equal(nativeClockAction({...ended,ended:false},true),"play");
 assert.equal(nativeClockAction({...ended,ended:false,paused:false},true),"running");
 assert.equal(nativeClockAction({...ended,ended:false,readyState:1},true),"wait");
 const engine=read("lib/music-video/frame-preview-engine.ts");
 assert.ok(engine.includes("if(this.position>=timeline.durationMs)"));
 assert.ok(engine.includes("this.cb.position(timeline.durationMs);this.pause();return;"));
});


test("audible song stays master across cuts and gaps and mobile picture tolerates jitter",async()=>{
 const {songOwnsPreviewClock,mobileVideoSyncDecision}=await import("../lib/music-video/song-range.ts");
 const range={startMs:0,endMs:5000,positionMs:0},parts=[{startMs:0,endMs:2000},{startMs:3000,endMs:5000}];
 assert.ok(songOwnsPreviewClock(range,parts,1000,false));assert.ok(!songOwnsPreviewClock(range,parts,2500,false));assert.ok(songOwnsPreviewClock(range,parts,3000,false));assert.ok(!songOwnsPreviewClock(range,parts,1000,true));
 assert.equal(mobileVideoSyncDecision(1,0.90,true,false,false).seek,false);
 assert.equal(mobileVideoSyncDecision(1,0.60,true,false,false).seek,true);
 assert.equal(mobileVideoSyncDecision(1,0.98,true,false,false).rate,1);
 const editor=read("components/music-video-editor.tsx");
 assert.ok(read('lib/music-video/frame-preview-engine.ts').includes('this.gain.gain.setValueAtTime'));
 assert.ok(editor.includes('data-volume-anchor="player"'));
 assert.ok(editor.includes('aria-label="Preview volume percent"'));
 assert.ok(editor.includes('engine.current?.setVolume(next/100)'));
 assert.ok(editor.includes('aria-orientation="vertical"'));
 assert.ok(editor.includes('onClick={()=>toggleTrackMute(track)}'));
 assert.ok(editor.includes('{playerVolumeButton()}'));
 assert.ok(!editor.includes('mv-volume-heading'));
 assert.ok(!editor.includes('mv-volume-footer'));
 const css=read("components/music-video.css");
 assert.ok(css.includes('writing-mode:vertical-lr;direction:rtl'));
 assert.ok(css.includes('touch-action:none;cursor:pointer'));
});

test("synchronized preview holds on missing, seeking, buffering or drifting picture",async()=>{
 const {pictureSyncGate}=await import("../lib/music-video/song-range.ts");
 const ready={currentTime:2,readyState:4,seeking:false,ended:false,duration:10};
 assert.equal(pictureSyncGate(2,null,false),"wait");
 assert.equal(pictureSyncGate(2,{...ready,readyState:1},false),"wait");
 assert.equal(pictureSyncGate(2,{...ready,readyState:2},true),"ready");
 assert.equal(pictureSyncGate(2,{...ready,seeking:true},true),"wait");
 assert.equal(pictureSyncGate(2,{...ready,currentTime:1.8},true),"align");
 assert.equal(pictureSyncGate(2,{...ready,currentTime:1.94},true),"ready");
 assert.equal(pictureSyncGate(2,{...ready,currentTime:1.94},false),"align");
 assert.equal(pictureSyncGate(2,{...ready,currentTime:1.98},false),"ready");
 assert.equal(pictureSyncGate(10,{...ready,currentTime:9.98,ended:true,readyState:2},true),"ready");
 assert.equal(pictureSyncGate(2,{...ready,ended:true},false),"align");
 const engine=read("lib/music-video/frame-preview-engine.ts"),timeline=read("lib/music-video/frame-timeline.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(engine.includes("this.scheduledThrough"));
 assert.ok(engine.includes("this.stopClock();this.cb.position(this.position);this.ensureStart();return;"));
 assert.ok(engine.includes("this.position=Math.min(timeline.durationMs,this.scheduledThrough"));
});

test("lookahead requires bounded buffered runway, not media in intentional gaps",async()=>{
 const {hasPreviewBuffer,PREVIEW_LOOKAHEAD_MS,nextVisibleClipTransition}=await import("../lib/music-video/song-range.ts");
 const ranges=(values:number[][])=>({length:values.length,start:(i:number)=>values[i][0],end:(i:number)=>values[i][1]});
 assert.equal(PREVIEW_LOOKAHEAD_MS,30000);
 assert.equal(hasPreviewBuffer(ranges([[0,2]]),1,10),false);
 assert.equal(hasPreviewBuffer(ranges([[0,3]]),1,10),true);
 assert.equal(hasPreviewBuffer(ranges([[0,1.1],[1.5,4]]),1,10),false);
 assert.equal(hasPreviewBuffer(ranges([[1,1.3]]),1,1.3),true);
 const clip={id:"next",track:1 as const,timelineStartMs:18000,sourceInMs:500,sourceOutMs:3000};
 assert.equal(nextVisibleClipTransition([clip],0,[18000,20500],{1:true,2:true})?.atMs,18000);
 const engine=read("lib/music-video/frame-preview-engine.ts");
 assert.ok(engine.includes("frames.set(frame,null)"));
 assert.ok(engine.includes("FRAME_CACHE_LIMIT=6"));
 assert.ok(engine.includes("this.scheduledThrough-this.position<PLAYBACK_LOOKAHEAD_MS"));
});


test("reverse scrubbing retains bounded preceding decoder across cuts and gaps",async()=>{
 const {previousVisibleClipTransition}=await import("../lib/music-video/song-range.ts");
 const a={id:"a",track:1 as const,timelineStartMs:0,sourceInMs:0,sourceOutMs:5000};
 const b={id:"b",track:2 as const,timelineStartMs:10000,sourceInMs:1000,sourceOutMs:4000};
 const boundaries=[0,5000,10000,13000],mutes={1:true,2:true};
 assert.equal(previousVisibleClipTransition([a,b],11000,boundaries,mutes)?.clip.id,"a");
 assert.equal(previousVisibleClipTransition([a,b],8000,boundaries,mutes)?.clip.id,"a");
 assert.equal(previousVisibleClipTransition([a,b],1000,boundaries,mutes),undefined);
 assert.equal(previousVisibleClipTransition([a,b],50000,boundaries,mutes),undefined);
 const engine=read("lib/music-video/frame-preview-engine.ts"),timeline=read("lib/music-video/frame-timeline.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(engine.includes("seek!==this.seekVersion"));
 assert.ok(engine.includes("this.frameWanted"));
 assert.ok(editor.includes("engine.current?.scrub(true)"));
 assert.ok(editor.includes("engine.current?.scrub(false)"));
});

test("project video display names never mutate the original or another project",()=>{
 const core=read("lib/music-video/core.ts"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),editor=read("components/music-video-editor.tsx");
 const rename=core.slice(core.indexOf("export function renameMusicAsset"),core.indexOf("export function removeMusicAsset"));
 assert.ok(rename.includes("requireMusicProject(id,owner)"));
 assert.ok(rename.includes("musicAsset(id,owner,assetId)"));
 assert.ok(rename.includes("WHERE id=? AND owner_id=? AND revision=?"));
 assert.ok(rename.includes("UPDATE music_assets SET name=? WHERE id=? AND project_id=?"));
 assert.ok(!rename.includes("source_id="));
 assert.ok(!rename.includes("music_clips"));
 assert.ok(api.includes("renameMusicAsset(id,owner,assetId,body.name,body.revision)"));
 assert.ok(editor.includes('title="Rename only in this project"'));
 assert.ok(editor.includes("body:JSON.stringify({name,revision:revision.current})"));
});
test("frame replay retains bounded windows and private ranged source caches",()=>{
 const engine=read("lib/music-video/frame-preview-engine.ts");
 assert.ok(engine.includes("FRAME_CACHE_LIMIT=6"));
 assert.ok(engine.includes("SOURCE_CACHE_LIMIT=6"));
 assert.ok(engine.includes("maxCacheSize:8*1024*1024"));
 assert.ok(engine.includes('redirect:"error"'));
 assert.ok(engine.includes("s.input.dispose()"));
});


test("paused current-frame decoder is allowed to start and transient startup drift is bounded",async()=>{
 const {pictureSyncGate,previewRunningGate}=await import("../lib/music-video/song-range.ts");
 const media={currentTime:0,readyState:2,seeking:false,ended:false,duration:5};
 assert.equal(pictureSyncGate(0,media,false),"ready");
 assert.equal(pictureSyncGate(0,{...media,readyState:1},false),"wait");
 assert.equal(previewRunningGate(.15,media,100),"ready");
 assert.equal(previewRunningGate(.15,media,200),"align");
 assert.equal(previewRunningGate(.25,media,100),"align");
 const engine=read("lib/music-video/frame-preview-engine.ts"),timeline=read("lib/music-video/frame-timeline.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(!editor.includes("hasPreviewBuffer(element.buffered"));
 assert.ok(engine.includes("await this.window(index)"));
 assert.ok(engine.includes("this.anchorTime=this.audio!.currentTime+.08"));
 assert.ok(engine.includes("this.paint(target.frame,current.frames.get(target.frame)!)"));
});


test("Projects song sections have no visible section numbers and retain accessible selection",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(!editor.includes("mv-song-part-number"));
 assert.ok(editor.includes('aria-label={"Select song part "+(i+1)}'));
 assert.ok(editor.includes("currentParts.map((p,i)"));
});


test("Projects has one frame-driven preview, not two modes or a server render during editing",()=>{
 const editor=read("components/music-video-editor.tsx"),engine=read("lib/music-video/frame-preview-engine.ts");
 assert.ok(editor.includes('data-frame-preview="true"'));
 assert.ok(!editor.includes("Synced review"));
 assert.ok(!editor.includes("/timeline-preview"));
 assert.ok(!editor.includes("<audio"));
 const libraryPreviewStart=editor.indexOf('{libraryPreview&&<dialog');
 assert.ok(libraryPreviewStart>=0);
 const libraryPreviewEnd=editor.indexOf('</dialog>}',libraryPreviewStart);
 assert.ok(libraryPreviewEnd>libraryPreviewStart);
 const libraryPreview=editor.slice(libraryPreviewStart,libraryPreviewEnd);
 assert.ok(libraryPreview.includes('<video controls autoPlay playsInline preload="metadata"'));
 assert.ok(![editor.slice(0,libraryPreviewStart),editor.slice(libraryPreviewEnd)].some(part=>part.includes("<video")));
 assert.ok(engine.includes("new AudioContext"));
 assert.ok(engine.includes("sink.canvasesAtTimestamps"));
 assert.ok(engine.includes("node.start("));
});


test("frame player invalidates late seeks and does not re-render the project on edits",()=>{
 const editor=read("components/music-video-editor.tsx"),engine=read("lib/music-video/frame-preview-engine.ts");
 assert.ok(editor.includes("engine.current.setTimeline(frameTimeline"));
 assert.ok(engine.includes("seek!==this.seekVersion"));
 assert.ok(engine.includes("version!==this.version"));
 assert.ok(engine.includes("this.controller.abort()"));
 assert.ok(!editor.includes("downloadReview"));
});


test("frame engine warms upcoming clips and paints during continuous drag independently of audio",()=>{
 const engine=read("lib/music-video/frame-preview-engine.ts");
 assert.ok(engine.includes("CLIP_LOOKAHEAD_MS=20000"));
 assert.ok(engine.includes("PLAYBACK_LOOKAHEAD_MS=2000"));
 assert.ok(engine.includes("LOCAL_PROXY_BYTES=8*1024*1024"));
 assert.ok(engine.includes("new BlobSource(blob)"));
 assert.ok(engine.includes("this.pictureWindow(index)"));
 assert.ok(engine.includes("if(!latest.clip||ready?.has(latest.frame))"));
 assert.ok(engine.includes("this.warmScrub()"));
 assert.ok(engine.includes("frameTarget(this.timeline!,this.position)?.frame===target.frame"));
});


test("adaptive timeline graduations have readable major marks and bounded visible minor marks",async()=>{
 const {timelineGraduations,clampTimelineZoom,timelineFitZoom,anchoredScroll,swipeVelocity,inertiaStep}=await import("../lib/music-video/timeline-gestures.ts");
 for(const [zoom,step] of [[20,5000],[44,2000],[100,1000],[200,500],[880,100]]){
  const scale=timelineGraduations(7200000,zoom,0,390);assert.equal(scale.step,step);
  assert.ok(scale.ticks.length<50);assert.ok(scale.ticks.some(t=>!t.major));
  assert.ok(scale.ticks.filter(t=>t.major).every(t=>t.ms%step===0));
 }
 const scrolled=timelineGraduations(7200000,880,100000,390);assert.ok(scrolled.ticks.length<50&&scrolled.ticks[0].ms>0);
 assert.equal(clampTimelineZoom(1),20);assert.equal(clampTimelineZoom(9999),880);
 assert.equal(timelineFitZoom(4000,1120),280);assert.equal(timelineFitZoom(4000,260),65);
 assert.equal(timelineFitZoom(600000,1120),20);assert.equal(timelineFitZoom(0,320),20);
 assert.equal(timelineFitZoom(100,1120),11200);
 assert.equal(anchoredScroll(4000,100,150),250);
 assert.equal(anchoredScroll(0,100,150),0);
 const speed=swipeVelocity(0,100,50),step=inertiaStep(speed,16);
 assert.ok(step.delta>0&&step.velocity<speed);assert.ok(inertiaStep(-speed,16).delta<0);
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes("timelineGraduations(timelineLimit,zoom,rulerViewport.scrollLeft,rulerViewport.width)"));
 assert.ok(editor.includes("pinch.zoom*g.distance/pinch.distance"));
 assert.ok(editor.includes('new PointerEvent("pointercancel"'));
 assert.ok(editor.includes("glide(scroller,velocity)"));
});

test("Experimental Projects requires matching authenticated customer media owner",()=>{
 const api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.match(api,/owner\.startsWith\("customer:"\)&&logged\?\.owner==="customer-"\+owner\.slice\(9\)/);
 assert.match(api,/service\.view\(a\.sourceId,mediaOwner\)/);
 assert.match(api,/service\.output\(a\.sourceId,mediaOwner\)/);
 assert.match(api,/requireMusicProject\(id,owner\)/);
});

test("position lock protects ordinary and lip sync clips independently of Sync Lock",async()=>{
 const {positionVideoClip,transferVideoClip,trimVideoClip,splitVideoAtPlayhead,shiftLockedClips}=await import("../lib/music-video/song-range.ts");
 const clip={id:"a",track:1,timelineStartMs:1000,sourceInMs:0,sourceOutMs:2000,syncLocked:false,positionLocked:true};
 assert.equal(positionVideoClip([clip],clip,2000).status,"locked");
 assert.equal(transferVideoClip([clip],clip,2,1000).status,"locked");
 assert.deepEqual(trimVideoClip([clip],clip,"start",500,3000),clip);
 assert.equal(splitVideoAtPlayhead(clip,1500,"b"),null);
 assert.equal(shiftLockedClips([{...clip,syncLocked:true}],100),null);
 assert.equal(positionVideoClip([clip],{...clip,positionLocked:false},2000).status,"ok");
 const editor=read("components/music-video-editor.tsx"),core=read("lib/music-video/core.ts");
 assert.ok(editor.includes('aria-label="Re-Sync"'));
 assert.ok(editor.includes('selectedAsset?.role==="lip-sync"'));
 assert.ok(editor.includes('<AudioLines size={16} aria-hidden="true"/><span>Re-Sync</span>'));
 assert.ok(editor.includes("resetClipToSourceStart(latest.current,current"));
 assert.ok(core.includes("position_locked INTEGER NOT NULL DEFAULT 0"));
 assert.ok(core.includes("positionLocked:!!r.position_locked"));
});

test("position lock control is on the video clip, not the timeline toolbar",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes('togglePositionLock(c.id)'));
 assert.ok(editor.includes('className={"mv-clip-position-lock"'));
 assert.ok(!editor.includes('className={"mv-position-lock"'));
 assert.ok(editor.includes('closest(".mv-handle,.mv-clip-position-lock,.mv-clip-display-toggle")'));
});

test("per-clip eye switches only the displayed waveform or name",()=>{
 const editor=read("components/music-video-editor.tsx"),core=read("lib/music-video/core.ts");
 assert.ok(editor.includes("toggleClipDisplay(c.id)"));
 assert.ok(editor.includes("showVideoName:!current.showVideoName"));
 assert.ok(editor.includes("c.showVideoName?<span className="));
 assert.ok(core.includes("show_video_name INTEGER NOT NULL DEFAULT 0"));
 assert.ok(core.includes("showVideoName:!!r.show_video_name"));
});

test("timeline has an explicit empty selection",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes('const songSelected=selected==="song"'));
 assert.ok(editor.includes('function clearSelection(){setSelected(null);'));
 assert.ok(editor.includes('beginMediaGesture(e,"viewport",()=>{},clearSelection,false)'));
 assert.ok(editor.includes('{hasSelection&&<><button'));
});

test("clip padlock reflects Sync Lock and explicit unlock releases movement protection",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes("movementLocked=!!(c.positionLocked||c.syncLocked)"));
 assert.ok(editor.includes("positionLocked:!locked,syncLocked:locked?false:c.syncLocked"));
});

test("Lip Sync insertion trims overlap without changing the original source mapping",async()=>{
 const {fitSourceTimeClip,rollVideoBoundary}=await import("../lib/music-video/song-range.ts");
 const first={id:"first",track:1,timelineStartMs:1000,sourceInMs:0,sourceOutMs:4000,syncLocked:true};
 const second={id:"second",track:1,timelineStartMs:3500,sourceInMs:0,sourceOutMs:4000,syncLocked:true};
 const fitted=fitSourceTimeClip([first],second,9000)!;
 assert.deepEqual(fitted,{...second,timelineStartMs:5000,sourceInMs:1500});
 assert.equal(fitted.timelineStartMs-fitted.sourceInMs,second.timelineStartMs-second.sourceInMs);
 assert.equal(fitSourceTimeClip([first],{...second,sourceOutMs:1000},9000),null);
 assert.deepEqual(fitSourceTimeClip([],second,6000),{...second,sourceOutMs:2500});
 assert.deepEqual(fitSourceTimeClip([],{...second,timelineStartMs:-500},9000),{...second,timelineStartMs:0,sourceInMs:500});
 const left={...first,sourceOutMs:4000},right=fitted;
 const rolled=rollVideoBoundary([left,right],right,"start",-1000,()=>5000)!;
 assert.deepEqual(rolled,[{...left,sourceOutMs:3000},{...right,timelineStartMs:4000,sourceInMs:500}]);
 assert.deepEqual(rollVideoBoundary(rolled,rolled[0],"end",1000,()=>5000),[left,right]);
 assert.equal(rollVideoBoundary([{...left,positionLocked:true},right],right,"start",-1000,()=>5000),null);
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes("timelineStartMs:locked?asset.sourceStartMs!+songOffset(rangeRef.current)"));
 assert.ok(editor.includes("planSourceTimeInsertion(latest.current,candidate,limit,atMs)"));
});

test("deleting the leading song part ripples every clip, preserving original lip sync and locks",async()=>{
 const {removeLeadingSongPart,songOffset}=await import("../lib/music-video/song-range.ts");
 const range={startMs:0,endMs:15000,positionMs:0},parts=[{startMs:0,endMs:5000},{startMs:5000,endMs:15000}];
 const a={id:"a",track:1,timelineStartMs:2000,sourceInMs:0,sourceOutMs:6000,syncLocked:true,positionLocked:true};
 const b={id:"b",track:2,timelineStartMs:8000,sourceInMs:0,sourceOutMs:4000,syncLocked:false,positionLocked:true};
 const gone={...b,id:"gone",timelineStartMs:0,sourceOutMs:1000};
 const result=removeLeadingSongPart(range,parts,[a,b,gone])!;
 assert.equal(result.shiftMs,5000);assert.deepEqual(result.range,{startMs:5000,endMs:15000,positionMs:0});
 assert.deepEqual(result.clips,[{...a,timelineStartMs:0,sourceInMs:3000},{...b,timelineStartMs:3000}]);
 assert.equal(result.clips[0].timelineStartMs,2000+result.clips[0].sourceInMs+songOffset(result.range));
 assert.deepEqual(result.parts,[parts[1]]);
 assert.equal(removeLeadingSongPart(range,[parts[0]],[a]),null);
});

test("source insertion keeps at least five seconds at the source start and only trims neighboring edges",async()=>{
 const {planSourceTimeInsertion}=await import("../lib/music-video/song-range.ts");
 const a={id:"a",track:1,timelineStartMs:0,sourceInMs:0,sourceOutMs:10000,syncLocked:true,positionLocked:false};
 const b={...a,id:"b",timelineStartMs:2000,sourceOutMs:5000};
 const fresh=planSourceTimeInsertion([],b,10000,0)!;
 assert.equal(fresh.mode,"aligned");assert.deepEqual(fresh.clip,b);
 const outside=planSourceTimeInsertion([],{...b,timelineStartMs:-9000},8000,0)!;
 assert.equal(outside.mode,"manual");assert.equal(outside.clip.timelineStartMs,0);assert.equal(outside.clip.syncLocked,false);
 assert.equal(outside.clip.sourceOutMs,5000);
 assert.equal(planSourceTimeInsertion([],b,4000,0),null);
 const cut=planSourceTimeInsertion([a],b,10000,0)!;
 assert.equal(cut.mode,"cut");assert.equal(cut.clips.length,2);
 assert.deepEqual(cut.clip,b);
 assert.deepEqual(cut.clips.find(c=>c.id==="a"),{...a,timelineStartMs:7000,sourceInMs:7000});
 const tail=planSourceTimeInsertion([{...a,sourceOutMs:15000}],{...b,timelineStartMs:8000,sourceOutMs:10000},20000,0)!;
 assert.equal(tail.mode,"cut");assert.equal(tail.clip.timelineStartMs,8000);assert.equal(tail.clip.sourceInMs,0);assert.equal(tail.clip.sourceOutMs,5000);
 assert.deepEqual(tail.clips.find(c=>c.id==="a"),{...a,sourceOutMs:8000});
 const free=planSourceTimeInsertion([{...a,timelineStartMs:8000,sourceOutMs:3000}],{...b,sourceOutMs:10000},20000,0)!;
 assert.equal(free.clip.sourceOutMs,6000);
 const locked={...a,positionLocked:true};
 const alt=planSourceTimeInsertion([locked],b,10000,0)!;
 assert.equal(alt.mode,"alternate");assert.equal(alt.clip.track,2);assert.deepEqual(alt.clips[0],locked);
 assert.equal(planSourceTimeInsertion([locked,{...locked,id:"other",track:2}],b,10000,0),null);
 const covered={...a,id:"covered",timelineStartMs:3000,sourceOutMs:1000};
 const keep=planSourceTimeInsertion([covered],b,10000,0)!;
 assert.equal(keep.clip.track,2);assert.deepEqual(keep.clips[0],covered);
 const short=planSourceTimeInsertion([],{...b,sourceOutMs:3000},10000,0)!;
 assert.equal(short.clip.sourceOutMs,3000);
});

test("unlocking Lip Sync directly does not ask for confirmation",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(!editor.includes("Unlock song synchronization? Moving this clip can break lip sync."));
 assert.ok(editor.includes("positionLocked:!locked,syncLocked:locked?false:c.syncLocked"));
});

test("Lip Sync picker serves small private stills with source owner checks",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes('endpoint+id+"/lip-thumbnail/"+encodeURIComponent(s.id)'));
 const route=api.slice(api.indexOf('if(section==="lip-thumbnail"'),api.indexOf('if(section==="lip-sync"'));
 assert.ok(route.includes("projectLiveOwner(req,owner)"));
 assert.ok(route.includes("service.view(assetId,mediaOwner)"));
 assert.ok(route.includes("service.trashedAt(assetId,mediaOwner)"));
 assert.ok(route.includes('libraryThumbnail(id,"live-"+assetId'));
});

test("timeline toolbar uses a magnet and icon-only zoom with direct time submission",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes('aria-label="Snap to edges" aria-pressed={snap}'));
 assert.ok(editor.includes("<Magnet size={18}/>"));
 assert.ok(editor.includes("<ZoomOut size={18}/>")&&editor.includes("<ZoomIn size={18}/>"));
 assert.ok(!editor.includes('aria-label="Timeline zoom level"'));
 assert.ok(!editor.includes('aria-label="Go to exact time"'));
 assert.ok(editor.includes('enterKeyHint="go"'));
});

test("editor alternates clips in chronological order independently for each track",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('sort((a,b)=>a.timelineStartMs-b.timelineStartMs||a.id.localeCompare(b.id)).map((c,i)=>'));
 assert.ok(editor.includes('i%2===0?" mv-clip-alt-a":" mv-clip-alt-b"'));
 assert.ok(css.includes('.mv-clip.mv-clip-alt-a{background:#61337e}'));
 assert.ok(css.includes('.mv-clip.mv-clip-alt-b{background:#8b4fb3}'));
});

test("video trim inspection uses actual clip source edges and stable playback decoders",()=>{
 const editor=read("components/music-video-editor.tsx"),engine=read("lib/music-video/frame-preview-engine.ts");
 assert.ok(editor.includes("trimmingVideo.current?latest.current:clips"));
 assert.ok(editor.includes('edge==="start"?clip.sourceInMs:Math.max(clip.sourceInMs,clip.sourceOutMs-1)'));
 assert.ok(editor.includes("showTrimFrame(next,edge)"));
 assert.ok(engine.includes("this.trimTarget!==target||this.version!==version"));
 assert.ok(engine.includes("sink.getCanvas(target.sourceMs/1000)"));
});

test("Re-Sync stays in the timeline toolbar and is disabled for noneligible selections",()=>{
 const editor=read("components/music-video-editor.tsx");
 const start=editor.indexOf('<div className="mv-timeline-toolbar">');
 const end=editor.indexOf('{hasSelection&&',start);
 assert.ok(start>=0&&end>start);
 const toolbar=editor.slice(start,end);
 assert.ok(toolbar.includes('aria-label="Re-Sync"'));
 assert.ok(toolbar.includes('disabled={importing||songSelected||originalClipSongTime===null||!selectedClip||!!selectedClip.positionLocked}'));
 assert.equal(editor.match(/aria-label="Re-Sync"/g)?.length,1);
});

test("library compatible preview is explicitly opened, pauses timeline playback and unmounts on close",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes('useState<MusicAsset|null>(null)'));
 assert.ok(editor.includes('onClick={()=>{stopPlayback();setLibraryPreviewError(false);setLibraryPreviewSrc(null);setLibraryPreview(a);}}'));
 assert.ok(editor.includes('src={libraryPreviewSrc}'));
 assert.ok(editor.includes('const proxy=endpoint+id+"/preview/"+encodeURIComponent(libraryPreview.id)+"?mobile=1"'));
 assert.ok(editor.includes('>(proxy,{method:"POST",signal})'));
 assert.ok(editor.includes('if(data.ready){if(!signal.aborted)setLibraryPreviewSrc(proxy);return;}'));
 assert.ok(editor.includes('Preparing video preview…'));
 assert.ok(editor.includes('setLibraryPreviewSrc(original)'));
 assert.ok(editor.includes('aria-label="Close video preview" onClick={()=>setLibraryPreview(null)}'));
});


test("ordinary video finds space on the requested track even at song end",async()=>{
 const {planFreeVideoInsertion}=await import("../lib/music-video/song-range.ts");
 const lip={id:"lip",track:1,timelineStartMs:0,sourceInMs:0,sourceOutMs:20000,syncLocked:true,positionLocked:true};
 const video={id:"broll",track:2,timelineStartMs:0,sourceInMs:0,sourceOutMs:10000,syncLocked:false,positionLocked:false};
 const result=planFreeVideoInsertion([lip],video,20000,20000)!;
 assert.equal(result.track,2);assert.equal(result.timelineStartMs,15000);assert.equal(result.sourceOutMs,5000);
 assert.equal(planFreeVideoInsertion([lip],video,20000,0)!.sourceOutMs,10000);
 const occupied={...video,id:"other",timelineStartMs:14000,sourceOutMs:6000};
 const fit=planFreeVideoInsertion([lip,occupied],video,20000,19000)!;
 assert.equal(fit.timelineStartMs,9000);assert.equal(fit.sourceOutMs,5000);
 assert.equal(planFreeVideoInsertion([lip,{...occupied,timelineStartMs:0,sourceOutMs:20000}],video,20000,0),null);
 assert.equal(planFreeVideoInsertion([lip],{...video,sourceOutMs:2000},20000,20000)!.timelineStartMs,18000);
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes('planFreeVideoInsertion(latest.current,candidate,limit,atMs)'));
 assert.ok(editor.includes('addClip(a,a.role==="lip-sync"?1:2,playhead)'));
});


test("metadata-only role changes preserve decoded preview and audio timeline",async()=>{
 const {makeFrameTimeline,sameFrameTimeline}=await import("../lib/music-video/frame-timeline.ts");
 const clip={id:"clip",assetId:"asset",track:2 as const,timelineStartMs:0,sourceInMs:0,sourceOutMs:4000,syncLocked:true,showVideoName:false};
 const range={startMs:0,endMs:5000,positionMs:0},mutes={song:false,1:true,2:false};
 const before=makeFrameTimeline([clip],range,null,mutes);
 assert.equal(sameFrameTimeline(before,makeFrameTimeline([{...clip,syncLocked:false,showVideoName:true}],range,null,mutes)),true);
 assert.equal(sameFrameTimeline(before,makeFrameTimeline([{...clip,timelineStartMs:100}],range,null,mutes)),false);
 assert.equal(sameFrameTimeline(before,makeFrameTimeline([{...clip,sourceInMs:100}],range,null,mutes)),false);
 assert.equal(sameFrameTimeline(before,makeFrameTimeline([clip],range,null,{...mutes,2:true})),false);
 assert.equal(sameFrameTimeline(before,makeFrameTimeline([clip],{...range,endMs:4500},null,mutes)),false);
 const engine=read("lib/music-video/frame-preview-engine.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(engine.indexOf("sameFrameTimeline(this.timeline,timeline)")<engine.indexOf("this.controller.abort();",engine.indexOf("setTimeline(")));
 const role=editor.slice(editor.indexOf("async function changeAssetRole("),editor.indexOf("async function insertLipSync("));
 assert.ok(!role.includes("stopPlayback()"));assert.ok(role.includes("await saveNow()"));assert.ok(role.includes("await persistAssetRole(a,role)"));
 assert.ok(editor.includes("roleChanging?.id===a.id?roleChanging.role:a.role"));
});


test("a removed song leaves a persistent editable project and a replace action",()=>{
 const core=read("lib/music-video/core.ts"),editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(core.includes("ADD COLUMN song_removed INTEGER NOT NULL DEFAULT 0"));
 const detach=core.slice(core.indexOf("export function detachProjectSong"),core.indexOf("export function attachProjectSong"));
 assert.ok(detach.includes("UPDATE music_clips SET sync_locked=0"));assert.ok(!detach.includes("DELETE FROM music_clips"));
 assert.ok(editor.includes('className="mv-add-song"'));assert.ok(editor.includes('void removeEntireSong()'));assert.ok(editor.includes('void uploadReplacementSong(file)'));
 assert.ok(api.includes('attachProjectSong(id,owner,revision,version,songName,duration,records)'));
 assert.ok(api.includes('if(req.method==="POST"&&project.songRemoved)throw new MusicError("Add a song before exporting.",409)'));
});


test("Re-Sync resets only the selected clip to its exact original source start",async()=>{
 const {resetClipToSourceStart}=await import("../lib/music-video/song-range.ts");
 const clip={id:"a",track:1,timelineStartMs:6000,sourceInMs:250,sourceOutMs:1750,syncLocked:false,positionLocked:false};
 const asset={sourceStartMs:5000,sourceEndMs:9000,durationMs:4000},range={startMs:0,endMs:10000,positionMs:0};
 const other={...clip,id:"b",track:2,timelineStartMs:5000};
 assert.deepEqual(resetClipToSourceStart([clip,other],clip,asset,range,10000),{status:"ok",clip:{...clip,timelineStartMs:5000,sourceInMs:0,sourceOutMs:1500,syncLocked:true}});
 assert.equal(resetClipToSourceStart([clip,{...other,track:1}],clip,asset,range,10000).status,"collision");
 assert.equal(resetClipToSourceStart([clip],{...clip,positionLocked:true},asset,range,10000).status,"locked");
 assert.equal(resetClipToSourceStart([clip],clip,asset,range,4000).status,"bounds");
 const offset=resetClipToSourceStart([clip],clip,asset,{startMs:1000,endMs:10000,positionMs:0},9000);
 assert.equal(offset.status,"ok");if(offset.status==="ok")assert.equal(offset.clip.timelineStartMs,4000);
 const core=read("lib/music-video/core.ts"),editor=read("components/music-video-editor.tsx");
 assert.ok(core.includes("song_restore_json"));assert.ok(core.includes("JSON.stringify(snapshot)"));
 assert.ok(!editor.includes("Restore all"));assert.ok(editor.includes("?selectedAsset.sourceStartMs:null"));
});

 test("track controls scroll with the media lanes and reserve only compact origin space on mobile",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(!editor.includes('className="mv-track-labels"'));
 assert.ok(editor.includes('mv-label mv-track-origin'));
 assert.ok(editor.includes('scrollLeft=scroller.scrollLeft-gutter'));
 assert.ok(editor.includes('viewportX-trackGutter.current'));
 assert.ok(css.includes('--mv-track-origin-width:36px'));
 assert.ok(css.includes('margin-left:var(--mv-track-origin-width)'));
});

 test("manual source time is owner-scoped, revision checked, and only editable on uploaded assets",()=>{
 const core=read("lib/music-video/core.ts"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts"),editor=read("components/music-video-editor.tsx");
 const setter=core.slice(core.indexOf("export function setUploadedAssetSourceTime"),core.indexOf("export function renameMusicAsset"));
 assert.ok(setter.includes('asset.sourceKind!=="uploaded"'));
 assert.ok(setter.includes("requireMusicProject(id,owner)"));
 assert.ok(setter.includes("revision!==project.revision"));
 assert.ok(setter.includes("validSongRange(start,end,MAX_TIMELINE_MS)"));
 assert.ok(setter.includes("UPDATE music_assets SET source_start_ms=?,source_end_ms=?"));
 assert.ok(setter.includes("UPDATE music_clips SET sync_locked=0 WHERE project_id=? AND asset_id=?"));
 assert.ok(!setter.includes("SET timeline_start_ms"));
 assert.ok(api.includes("setUploadedAssetSourceTime(id,owner,assetId,body.sourceStartMs,body.sourceEndMs,body.revision)"));
 assert.ok(editor.includes("sourceStartMs:start,sourceEndMs:end,revision:revision.current"));
});
