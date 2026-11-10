"use client";

import {useCallback,useEffect,useRef,useState} from "react";

type Channel="mobile"|"desktop"|"desktop_portrait";
type Project={id:string;name:string;selected:boolean};
type Listing={projects:Project[];published:{id:string;title:string;position:number}[];inventory:{completedSuperAdmin:number;published:number;totalStudioRecords?:number;verifiedSuperAdmin?:number;incompleteSuperAdmin?:number;missingOutputRecord?:number;unverifiedLegacy?:number;uploadedVideos?:number}};
const channels:{id:Channel;label:string;hint:string}[]=[
 {id:"mobile",label:"Mobile · Inspiration Feed (9:16)",hint:"Unlimited SingMotion-approved ideas for vertical swipe browsing"},
 {id:"desktop",label:"Desktop · Top carousel (16:9)",hint:"Featured landscape performances below the fullscreen hero"},
 {id:"desktop_portrait",label:"Desktop · Stunning Creations (9:16)",hint:"Curated portrait performances in the lower carousel"},
];

export function ShowcaseManager(){
 const [channel,setChannel]=useState<Channel>("mobile");
 const [available,setAvailable]=useState<Project[]>([]);
 const [ordered,setOrdered]=useState<string[]>([]);
 const [saved,setSaved]=useState<string[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState("");
 const [inventory,setInventory]=useState<Listing["inventory"]|null>(null);
 const [uploading,setUploading]=useState(false);
 const [videoName,setVideoName]=useState("");
 const [uploadMessage,setUploadMessage]=useState("");
 const videoInput=useRef<HTMLInputElement>(null);
 const desktopBgInput=useRef<HTMLInputElement>(null);
 const mobileBgInput=useRef<HTMLInputElement>(null);
 const [backgroundRevision,setBackgroundRevision]=useState(0);
 const [backgroundSaving,setBackgroundSaving]=useState<string|null>(null);
 const upload=async(kind:"video"|"desktop-bg"|"mobile-fallback",file:File|null)=>{
  if(!file)return;
  setUploadMessage("");setUploading(true);setBackgroundSaving(kind);
  try{
   const form=new FormData();form.append("kind",kind);form.append("file",file);
   if(kind==="video")form.append("title",videoName.trim()||file.name);
   const res=await fetch("/api/showcase-media",{method:"POST",credentials:"same-origin",body:form});
   const data=await res.json() as {ok?:boolean;error?:string;title?:string};
   if(!res.ok)throw Error(data.error||"Upload failed");
   if(kind==="video"){
    await load();
    setVideoName("");
    if(videoInput.current)videoInput.current.value="";
    setUploadMessage("Video hochgeladen. Wähle es unten für einen oder mehrere Bereiche aus und klicke auf Veröffentlichen.");
   }else{
    setBackgroundRevision(Date.now());
    setUploadMessage(kind==="desktop-bg"?"Desktop-Hintergrund aktualisiert.":"Mobiles Fallback-Bild aktualisiert.");
   }
  }catch(e){setUploadMessage((e as Error).message);}
  finally{setUploading(false);setBackgroundSaving(null);}
 };

 const load=useCallback(async()=>{
  setLoading(true);setMessage("");
  try{
   const res=await fetch("/api/showcase?admin=1&channel="+channel,{credentials:"same-origin",cache:"no-store"});
   const data=await res.json() as Listing&{error?:string};
   if(!res.ok)throw Error(data.error||"Could not load Super Admin videos");
   setAvailable(data.projects||[]);
   setInventory(data.inventory||null);
   const ids=(data.published||[]).map(item=>item.id);
   setOrdered(ids);setSaved(ids);
  }catch(e){setMessage((e as Error).message);}
  finally{setLoading(false)}
 },[channel]);
 useEffect(()=>{void load()},[load]);
 const add=(id:string)=>setOrdered(current=>current.includes(id)?current:[...current,id]);
 const remove=(id:string)=>setOrdered(current=>current.filter(x=>x!==id));
 const shift=(i:number,delta:number)=>setOrdered(current=>{
  const dest=i+delta;if(dest<0||dest>=current.length)return current;
  const next=[...current];[next[i],next[dest]]=[next[dest],next[i]];return next;
 });
 const save=async()=>{
  setSaving(true);setMessage("");
  try{
   const res=await fetch("/api/showcase?channel="+channel,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set-list",ids:ordered})});
   const data=await res.json() as {error?:string};
   if(!res.ok)throw Error(data.error||"Could not save");
   setSaved([...ordered]);setMessage("Published successfully for this section.");
  }catch(e){setMessage((e as Error).message);}
  finally{setSaving(false);}
 };
 const name=(id:string)=>available.find(x=>x.id===id)?.name||id;
 const dirty=ordered.join("\n")!==saved.join("\n");
 return <div style={{border:"1px solid #764e86",borderRadius:16,padding:20,margin:"18px 0",background:"#160d22",color:"#f8efff"}}>
  <h2 style={{fontSize:21,margin:"0 0 8px"}}>Showcase videos verwalten</h2>
  <p style={{fontSize:13,opacity:.85}}>Super Admin: Inhalte separat je Bereich veröffentlichen und ihre Reihenfolge bestimmen. Nicht ausgewählte Projekte bleiben privat.</p>
  <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"18px 0"}} role="group" aria-label="Choose display section">
   {channels.map(c=><button type="button" key={c.id} aria-pressed={channel===c.id} onClick={()=>setChannel(c.id)} style={{border:"1px solid #8951a9",borderRadius:10,padding:"10px 12px",background:channel===c.id?"#8b2ec3":"#281437",color:"#fff",cursor:"pointer"}}>{c.label}</button>)}
  </div>
  <p style={{fontSize:12,opacity:.8}}>{channels.find(x=>x.id===channel)?.hint}</p>
  <section style={{padding:"16px 0",borderTop:"1px solid #604074",marginTop:16}}>
   <h3 style={{fontSize:17,margin:"0 0 7px"}}>Eigenes Video hochladen</h3>
   <p style={{fontSize:13,opacity:.8}}>MP4 oder WebM, maximal 80 MiB. Ein Upload ist noch nicht öffentlich. Danach kannst du ihn jedem der drei Bereiche separat zuordnen.</p>
   <div style={{display:"flex",gap:9,alignItems:"center",flexWrap:"wrap"}}>
    <input placeholder="Videotitel" aria-label="Videotitel" value={videoName} onChange={e=>setVideoName(e.target.value)} maxLength={120} style={{padding:9,borderRadius:7,background:"#241431",color:"white",border:"1px solid #83529d"}}/>
    <input ref={videoInput} type="file" accept="video/mp4,video/webm,.mp4,.webm" aria-label="Video auswählen" disabled={uploading} onChange={e=>void upload("video",e.target.files?.[0]||null)}/>
   </div>
  </section>
  <section style={{padding:"16px 0",borderTop:"1px solid #604074",marginTop:16}}>
   <h3 style={{fontSize:17,margin:"0 0 8px"}}>Hintergrundbilder</h3>
   <p style={{fontSize:13,opacity:.8}}>Im CMS unabhängig austauschen. JPEG, PNG oder WebP, maximal 5 MiB. Das mobile Bild erscheint nur, solange ein Video nicht geladen werden kann.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:15}}>
    <label style={{display:"grid",gap:8}}>
     <strong>Desktop Fullscreen-Hero</strong>
     <img src={"/api/showcase-media?kind=desktop-bg&v="+backgroundRevision} alt="Aktueller Desktop-Hintergrund" style={{width:"100%",height:135,objectFit:"cover",borderRadius:8}}/>
     <input ref={desktopBgInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e=>void upload("desktop-bg",e.target.files?.[0]||null)}/>
    </label>
    <label style={{display:"grid",gap:8}}>
     <strong>Mobile Video-Fallback</strong>
     <img src={"/api/showcase-media?kind=mobile-fallback&v="+backgroundRevision} alt="Aktuelles mobiles Ersatzbild" style={{width:110,height:155,objectFit:"cover",borderRadius:8}}/>
     <input ref={mobileBgInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e=>void upload("mobile-fallback",e.target.files?.[0]||null)}/>
    </label>
   </div>
  </section>
  {uploadMessage&&<p role="status" style={{margin:"10px 0",fontSize:13,color:"#efd4ff"}}>{uploadMessage}</p>}
  {loading?<p role="status">Loading video inventory…</p>:<>
   <h3 style={{fontSize:16,margin:"22px 0 8px"}}>Published in this section ({ordered.length})</h3>
   {ordered.length===0&&<p style={{fontSize:13}}>No videos published here yet.</p>}
   <ol style={{paddingLeft:28}}>
    {ordered.map((id,i)=><li key={id} style={{padding:"8px 0",borderBottom:"1px solid #ffffff22"}}>
     <span>{name(id)}</span>
     <span style={{display:"inline-flex",gap:5,marginLeft:15}}>
      <button type="button" disabled={i===0} onClick={()=>shift(i,-1)} aria-label={"Move "+name(id)+" up"}>↑</button>
      <button type="button" disabled={i===ordered.length-1} onClick={()=>shift(i,1)} aria-label={"Move "+name(id)+" down"}>↓</button>
      <button type="button" onClick={()=>remove(id)} aria-label={"Remove "+name(id)}>Remove</button>
     </span>
    </li>)}
   </ol>
   {inventory&&<div style={{border:"1px solid #704c81",borderRadius:10,padding:12,marginTop:16,background:"#21122d",fontSize:13}} role="status">
    <strong>Video-Bestand dieser Staging-Umgebung</strong>
    <p style={{margin:"7px 0 2px"}}>Alle Studio-Einträge: {inventory.totalStudioRecords??"–"} · Als Super Admin bestätigt: {inventory.verifiedSuperAdmin??"–"} · Verfügbare fertige Videos: {inventory.completedSuperAdmin} · Eigene Uploads: {inventory.uploadedVideos??0}</p>
    <p style={{margin:"4px 0"}}>Noch nicht fertig / ohne Ausgabe: {inventory.incompleteSuperAdmin??"–"} · Fehlende alte Ausgabe-Einträge: {inventory.missingOutputRecord??"–"} · Ohne überprüfbaren Super-Admin-Nachweis: {inventory.unverifiedLegacy??"–"}</p>
    <p style={{margin:"6px 0 0",opacity:.8}}>Die Auswahl ist nicht auf drei Videos begrenzt. Fehlende alte Produktionen können in einer anderen Umgebung liegen oder noch nicht als sichere Veröffentlichungsquelle erfasst sein. Sie werden nicht automatisch öffentlich gemacht.</p>
   </div>}
   <h3 style={{fontSize:16,margin:"22px 0 8px"}}>Verfügbare Super-Admin-Videos und Uploads ({available.length})</h3>
   <div style={{maxHeight:280,overflowY:"auto",display:"grid",gap:6}}>
    {available.filter(x=>!ordered.includes(x.id)).map(x=><button key={x.id} type="button" onClick={()=>add(x.id)} style={{textAlign:"left",padding:"10px 12px",borderRadius:8,background:"#2a1739",color:"#fff",border:"1px solid #68417d"}}>+ {x.name}</button>)}
    {available.length===0&&<p style={{fontSize:13}}>No completed Super Admin videos available in this environment.</p>}
   </div>
   <button type="button" disabled={saving||!dirty} onClick={()=>void save()} style={{marginTop:18,padding:"12px 20px",borderRadius:10,background:"#ad35d9",color:"#fff",border:0,fontWeight:700}}>{saving?"Saving…":"Publish selection & order"}</button>
  </>}
  {message&&<p role="status" style={{marginTop:12,fontSize:13}}>{message}</p>}
 </div>;
}
