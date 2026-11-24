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
 assert.ok(editor.includes("Upload own video"));
 assert.ok(editor.includes('await ensureSession()'));
 assert.ok(editor.includes('addClip(a,track,source.sourceStartMs)'));
 assert.ok(editor.includes('if(track!==null)addClip(result.asset,track,playhead)'));
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
 assert.ok(editor.includes("parseSongTime(startText)"));
 assert.ok(editor.includes("apply(moved,true,next)"));
 assert.ok(editor.includes("if(at>=end){current.pause();at=end;}"));
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
 assert.ok(editor.includes("parseSongTime(positionText)"));
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
 assert.ok(editor.includes("submitClipTime()"));
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
 assert.ok(editor.includes('onClick={()=>cutSong("start")}'));
 assert.ok(editor.includes('onClick={()=>cutSong("end")}'));
 assert.ok(editor.includes("commitSongRange(next,next.positionMs)"));
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
 assert.ok(editor.includes('aria-label="Video end time on timeline"'));
 assert.ok(editor.includes("scroller.scrollLeft=startScroll-dx"));
 assert.ok(editor.includes('beginMediaGesture(e,c.id,()=>movePointer(e,c,"move")'));
 assert.ok(editor.includes('beginMediaGesture(e,"song",()=>dragSong(e)'));
 assert.ok(editor.includes('track===1?"Lip Sync":"Video 2"'));
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

test("timeline adds stay on the right and the song shares a single selection inspector",()=>{
 const editor=read("components/music-video-editor.tsx"),css=read("components/music-video.css");
 assert.ok(editor.includes('const songSelected=!selectedClip||!selectedAsset'));
 assert.ok(editor.includes('function selectSong(){setSelected(null);setAddMenu(null);}'));
 assert.ok(editor.includes('beginMediaGesture(e,"song",()=>dragSong(e),selectSong)'));
 assert.ok(editor.includes('aria-label="Select song" aria-pressed={songSelected}'));
 assert.ok(editor.includes('!songSelected&&selectedClip&&selectedAsset?<form'));
 assert.ok(editor.includes('</form>:\n      <form className="mv-song-trim mv-song-position"'));
 const scroll=editor.indexOf('<div className="mv-scroll"');
 const adds=editor.indexOf('<div className="mv-track-adds"');
 assert.ok(scroll>=0&&adds>scroll);
 assert.ok(editor.indexOf('aria-label={"Add video to track "+track}')>adds);
 assert.ok(css.includes('.mv-track-adds .mv-add-menu{left:auto;right:3px'));
 assert.ok(css.includes('.mv-song-block.is-selected'));
});
