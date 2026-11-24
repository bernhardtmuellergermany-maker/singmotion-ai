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


test("unreleased Projects stays CMS Super Admin only across page/API/menu",()=>{
 const auth=read("lib/music-video/auth.ts");
 const menu=read("components/global-menu.tsx");
 const page=read("app/(site)/projects/page.tsx");
 const detail=read("app/(site)/projects/[id]/page.tsx");
 const api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.match(auth,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(auth,/if\(store\.session\(customerToken\)\)return null/);
 assert.match(menu,/setMusicEnabled\(false\)/);
 assert.match(menu,/current===serial/);
 assert.match(auth,/CMS_ENABLED!=="true"/);
 assert.doesNotMatch(auth,/MUSIC_VIDEO_CUSTOMER_ENABLED|return "customer:"/);
 assert.match(menu,/fetch\("\/api\/music-video"/);
 assert.doesNotMatch(menu,/auth\?\.authenticated&&auth\.kind==="customer"|staffRole==="super-admin"/);
 assert.match(menu,/musicEnabled&&<Link href="\/projects"/);
 for(const s of [page,detail,api])assert.match(s,/musicPrincipal\(/);
 assert.match(api,/if\(!owner\)throw new MusicError\("Music Video Builder access denied\.",403\)/);
});

test("Projects offers owned completed Lip Sync insertion and separate user video uploads",()=>{
 const editor=read("components/music-video-editor.tsx"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes("Insert Lip Sync"));
 assert.ok(editor.includes("Upload video"));
 assert.ok(editor.includes('await ensureSession()'));
 assert.ok(editor.includes('addClip(a,track,source.sourceStartMs)'));
 assert.ok(editor.includes('await load();setLibraryOpen(true);setFilter("Uploads")'));
 assert.ok(!editor.includes("if(track!==null)addClip(result.asset,track,playhead)"));
 assert.ok(editor.includes('filter==="Uploads"&&a.kind==="imported"'));
 assert.ok(api.includes('section==="lip-sync"'));
 assert.ok(api.includes('logged?.owner!=="cms-staff-"+owner.slice(6)'));
 assert.ok(api.includes('service.list(logged.owner).filter(p=>p.outputReady&&!p.hidden)'));
 assert.ok(api.includes('service.trashedAt(ref,logged.owner)!==null'));
 assert.ok(api.includes('await service.output(ref,logged.owner)'));
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
 assert.ok(editor.includes("if(at>=end||current.ended){current.pause();at=end;}"));
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
 assert.ok(editor.includes('field==="position"?positionText:'));
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
 assert.ok(editor.includes('onConfirm={()=>submitClipTime("song")}'));
 assert.ok(editor.includes("positionVideoClip(latest.current,current,position)"));
 assert.ok(editor.includes("songTimeToTimeline(ms,rangeRef.current)"));
 assert.ok(editor.includes("Restore Lip Sync"));
 assert.ok(editor.includes("syncLocked:restore||current.syncLocked"));
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
 assert.ok(editor.includes("onClick={switchVideoTrack}"));
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
 const songLaneLabel=editor.split("\n").find(line=>line.includes('className="mv-label mv-audio-label"'));
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
 assert.ok(editor.includes('track===1?"Lip-Sync":"Video"'));
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
 assert.ok(editor.includes('const locked=asset.role==="lip-sync"&&asset.sourceStartMs'));
 assert.ok(editor.includes('a.role==="lip-sync"?1:2'));
 assert.ok(editor.includes('persistAssetRole(existing,"lip-sync")'));
});

test("timeline zoom is visibly separate from playback progress",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('role="group" aria-label="Timeline zoom"'));
 assert.ok(editor.includes('aria-label="Zoom out timeline"'));
 assert.ok(editor.includes('aria-label="Zoom in timeline"'));
 assert.ok(editor.includes('setZoom(z=>Math.max(20,z-12))'));
 assert.ok(editor.includes('setZoom(z=>Math.min(140,z+12))'));
 assert.ok(!editor.includes('aria-label="Timeline zoom" type="range"'));
 assert.ok(editor.includes('value={progress.positionMs}'));
 assert.ok(css.includes(".mv-timeline-zoom .mv-zoom-buttons"));
});

test("timeline uses full width and media is added from the library",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('const songSelected=!selectedClip||!selectedAsset'));
 assert.ok(editor.includes('function selectSong(){setSelected(null);setInspectorOpen(true);}'));
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
 assert.ok(editor.includes("songPartAt(range,continuousSongParts(range,partsRef.current),at)"));
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
 assert.ok(api.includes("startMusicExport(owner,detail.project,detail.clips,files,songFile)"));
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
 assert.ok(editor.includes("muted={trackMutes.song}"));
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

test("desktop mouse starts editing immediately; touch retains long-press scrolling",()=>{
 const editor=read("components/music-video-editor.tsx");
 const gesture=editor.slice(editor.indexOf("function beginMediaGesture("),editor.indexOf("function dragSong(e:"));
 assert.ok(gesture.includes('if(e.pointerType==="mouse"){setArmedMedia(media);onHold();return;}'));
 assert.ok(gesture.indexOf('if(e.pointerType==="mouse")')<gesture.indexOf("setTimeout("));
 assert.ok(gesture.includes("mediaPanAxis(dx,dy)"));
 assert.ok(gesture.includes("},MEDIA_HOLD_MS)"));
 assert.ok(!gesture.includes("immediate&&"));
});

test("preview and render share exact source time, and playback corrects drift within frame-scale tolerances",async()=>{
 const {clipSourceTimeMs,mediaSyncDecision}=await import("../lib/music-video/song-range.ts");
 const clip={timelineStartMs:2804,sourceInMs:715,sourceOutMs:5000};
 assert.equal(clipSourceTimeMs(clip,2804),715);
 assert.equal(clipSourceTimeMs(clip,3804),1715);
 assert.equal(clipSourceTimeMs(clip,0),715);
 assert.equal(clipSourceTimeMs(clip,9000),5000);
 assert.equal(mediaSyncDecision(1,0.8,true,false,false).seek,true);
 assert.equal(mediaSyncDecision(1,0.94,true,false,false).seek,true);
 assert.equal(mediaSyncDecision(1,0.975,true,false,false).seek,false);
 assert.ok(mediaSyncDecision(1,0.975,true,false,false).rate>1);
 assert.ok(mediaSyncDecision(1,1.025,true,false,false).rate<1);
 assert.equal(mediaSyncDecision(1,0.8,true,false,true).seek,false);
 assert.equal(mediaSyncDecision(1,0.998,false,true,false).seek,true);
 const editor=read("components/music-video-editor.tsx"),renderer=read("lib/music-video/export.ts"),api=read("app/(site)/api/music-video/[[...parts]]/route.ts");
 assert.ok(editor.includes("clipSourceTimeMs(clip,at)"));
 assert.ok(renderer.includes("clipSourceTimeMs(clip,at)"));
 assert.ok(editor.includes("songClockRunning(at)"));
 assert.ok(editor.includes("onWaiting={pauseFollowers}"));
 assert.ok(api.includes("const inspected=await probe(file)"));
 assert.ok(api.includes("duration=toMs(measured)"));
 assert.ok(!editor.includes("playing?0.24:0.001"));
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
 assert.ok(editor.includes("firstVisibleVideo(clips)"));
 assert.ok(api.includes("inspectVideoDimensions(files.get(assetId)!)"));
});

test("video inspector groups source start/end before timeline start/end",()=>{
 const editor=read("components/music-video-editor.tsx");
 const start=editor.indexOf('className="mv-video-times"');
 const end=editor.indexOf('{originalClipSongTime!==null',start);
 assert.ok(start>=0&&end>start);
 const labels=[...editor.slice(start,end).matchAll(/<InlineTimeField label="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(labels,["Video start time","Video end time","Timeline start","Timeline end"]);
 assert.ok(editor.includes("Original song time"));
 assert.ok(editor.includes("Position in the full, untrimmed song"));
 assert.ok(editor.includes("Position in this music video project"));
 assert.ok(editor.includes('onConfirm={()=>submitClipTime("timeline")}'));
 assert.ok(editor.includes('onConfirm={()=>submitClipEnd("timeline")}'));
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
 assert.ok(editor.includes('aria-label="Rename song"'));
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
  assert.ok(page.includes('className="mv-browse-filter"'));
  assert.ok(page.includes("Newest first"));
  assert.ok(page.includes("Oldest first"));
 }
 assert.ok(client.includes('aria-label="Refresh projects"'));
 assert.ok(editor.includes('aria-label="Refresh library"'));
 assert.ok(editor.includes("libraryNewest?b.createdAt-a.createdAt:a.createdAt-b.createdAt"));
 assert.ok(client.includes("newest?b.updatedAt-a.updatedAt:a.updatedAt-b.updatedAt"));
 assert.ok(css.includes(".mv-root .mv-format-controls>span{margin-right:5px}"));
});

test("project and library menus dismiss on outside clicks and Escape; clip details stay compact",()=>{
 const client=read("components/music-projects-client.tsx"),editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 for(const page of [client,editor]){
  assert.ok(page.includes('document.addEventListener("pointerdown",outside,true)'));
  assert.ok(page.includes('if(!menu.contains(target))menu.open=false'));
  assert.ok(page.includes('event.key!=="Escape"'));
  assert.ok(page.includes('document.removeEventListener("pointerdown",outside,true)'));
 }
 assert.ok(editor.includes('c.track===1?<Mic size={12}'));
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
 assert.ok(api.includes("await exportSources(req,owner,id,musicDetail(id,owner),[assetId])"));
 assert.ok(api.includes('attachment; filename="'));
});

test("video and song time fields confirm inline and on Enter",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('className="mv-inline-confirm"'));
 assert.ok(editor.includes('if(e.key==="Enter"){e.preventDefault();if(!disabled)onConfirm();}'));
 assert.ok(editor.includes('onConfirm={()=>submitSongField("start")}'));
 assert.ok(editor.includes('onConfirm={()=>submitSongField("end")}'));
 assert.ok(editor.includes('onConfirm={()=>submitSongField("position")}'));
 assert.ok(!editor.includes(">Move video</button>"));
 assert.ok(!editor.includes(">Set end</button>"));
 assert.ok(!editor.includes(">Set part</button>"));
 assert.ok(css.includes("padding-right:34px!important"));
});

test("timeline does not append empty time after original song; existing longer edits remain visible",()=>{
 const editor=read("components/music-video-editor.tsx");
 assert.ok(editor.includes("Math.max(project.songDurationMs,songTimelineEnd(rangeRef.current),...latest.current.map(clipEnd))"));
 assert.ok(editor.includes("Math.max(1,timelineLimit/1000*zoom)"));
 assert.ok(!editor.includes("Math.max(project.songDurationMs,timelineEnd)+10000"));
 assert.ok(editor.includes("if(end>timelineLimit)"));
 assert.ok(editor.includes("Math.min(timelineLimit-(initial.sourceOutMs-initial.sourceInMs)"));
});
