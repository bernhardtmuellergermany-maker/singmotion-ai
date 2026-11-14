"use client";

import {useCallback,useEffect,useRef,useState} from "react";

type Channel="mobile"|"desktop"|"desktop_portrait";
type Project={id:string;name:string;selected:boolean;posterUrl?:string|null;source:"generated"|"upload"};
type Listing={randomOrder?:boolean;projects:Project[];hiddenVideos?:{id:string;name:string}[];published:{id:string;title:string;position:number}[];inventory:{completedSuperAdmin:number;published:number;totalStudioRecords?:number;verifiedSuperAdmin?:number;incompleteSuperAdmin?:number;missingOutputRecord?:number;unverifiedLegacy?:number;uploadedVideos?:number}};
const channels:{id:Channel;label:string;hint:string}[]=[
 {id:"mobile",label:"Mobile · Inspiration Feed (9:16)",hint:"Unlimited SingMotion-approved ideas for vertical swipe browsing"},
 {id:"desktop",label:"Desktop · Top carousel (16:9)",hint:"Featured landscape performances below the fullscreen hero"},
 {id:"desktop_portrait",label:"Desktop · Stunning Creations (9:16)",hint:"Curated portrait performances in the lower carousel"},
];

export function ShowcaseManager(){
 const [channel,setChannel]=useState<Channel>("mobile");
 const [available,setAvailable]=useState<Project[]>([]);
 const [hiddenVideos,setHiddenVideos]=useState<{id:string;name:string}[]>([]);
 const [cleaningId,setCleaningId]=useState<string|null>(null);
 const [ordered,setOrdered]=useState<string[]>([]);
 const [saved,setSaved]=useState<string[]>([]);
 const [randomOrder,setRandomOrder]=useState(false);
 const [savedRandomOrder,setSavedRandomOrder]=useState(false);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState("");
 const [inventory,setInventory]=useState<Listing["inventory"]|null>(null);
 const [uploading,setUploading]=useState(false);
 const [videoName,setVideoName]=useState("");
 const [uploadMessage,setUploadMessage]=useState("");
 const [posterSaving,setPosterSaving]=useState<string|null>(null);
 const uploadPoster=async(id:string,file:File|null)=>{
  if(!file)return;
  setPosterSaving(id);setUploadMessage("");
  try{
   const form=new FormData();form.append("kind","poster");form.append("id",id);form.append("file",file);
   const res=await fetch("/api/showcase-media",{method:"POST",credentials:"same-origin",body:form});
   const data=await res.json() as {url?:string;error?:string};
   if(!res.ok||!data.url)throw Error(data.error||"Vorschaubild konnte nicht gespeichert werden");
   setAvailable(items=>items.map(item=>item.id===id?{...item,posterUrl:data.url}:item));
   setBackgroundRevision(Date.now());
   setUploadMessage("Vorschaubild gespeichert. Es erscheint direkt bei diesem veröffentlichten Video.");
  }catch(e){setUploadMessage((e as Error).message)}
  finally{setPosterSaving(null)}
 };

 const deletePoster=async(id:string)=>{
  if(posterSaving!==null||!window.confirm("Vorschaubild entfernen? Das Video und seine Veröffentlichung bleiben erhalten."))return;
  setPosterSaving(id);setUploadMessage("");
  try{
   const res=await fetch("/api/showcase-media?kind=poster&id="+encodeURIComponent(id),{method:"DELETE",credentials:"same-origin"});
   const data=await res.json() as {ok?:boolean;error?:string};
   if(!res.ok||data.ok!==true)throw Error(data.error||"Vorschaubild konnte nicht entfernt werden");
   setAvailable(items=>items.map(item=>item.id===id?{...item,posterUrl:null}:item));
   setBackgroundRevision(Date.now());
   setUploadMessage("Vorschaubild entfernt. Das Video bleibt unverändert veröffentlicht.");
  }catch(e){setUploadMessage((e as Error).message)}
  finally{setPosterSaving(null)}
 };

 const videoInput=useRef<HTMLInputElement>(null);
 const desktopBgInput=useRef<HTMLInputElement>(null);
 const mobileBgInput=useRef<HTMLInputElement>(null);
 const [backgroundRevision,setBackgroundRevision]=useState(0);
 const [backgroundSaving,setBackgroundSaving]=useState<string|null>(null);
 const upload=async(kind:"video"|"desktop-bg"|"mobile-fallback"|"final-cta-bg",file:File|null)=>{
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
    setUploadMessage(kind==="desktop-bg"?"Desktop-Hintergrund aktualisiert.":kind==="final-cta-bg"?"CTA-Hintergrund aktualisiert.":"Mobiles Fallback-Bild aktualisiert.");
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
   setHiddenVideos(data.hiddenVideos||[]);
   setInventory(data.inventory||null);
   const ids=(data.published||[]).map(item=>item.id);
   setOrdered(ids);setSaved(ids);
   setRandomOrder(channel==="mobile"&&data.randomOrder===true);
   setSavedRandomOrder(channel==="mobile"&&data.randomOrder===true);
  }catch(e){setMessage((e as Error).message);}
  finally{setLoading(false)}
 },[channel]);
 useEffect(()=>{void load()},[load]);
 async function manageVideo(item:{id:string;name:string;source?:"generated"|"upload"},restore=false){
  if(cleaningId!==null||saving)return;
  const upload=item.source==="upload";
  const message=upload
   ?"Upload '"+item.name+"' endgültig aus der Showcase-Mediathek löschen? Veröffentlichungen in ALLEN Bereichen und das Vorschaubild werden entfernt. Dies betrifft keine Kundenprojekte."
   :restore
    ?"Generiertes Video '"+item.name+"' wieder in der CMS-Auswahl anzeigen? Es wird NICHT automatisch veröffentlicht."
    :"Generiertes Video '"+item.name+"' aus der CMS-Auswahl und ALLEN öffentlichen Bereichen ausblenden? Die Originaldatei und Generierungsnachweise bleiben erhalten.";
  if(!window.confirm(message))return;
  setCleaningId(item.id);setMessage("");
  try{
   const response=upload?await fetch("/api/showcase-media?kind=video&id="+encodeURIComponent(item.id),{
    method:"DELETE",credentials:"same-origin"
   }):await fetch("/api/showcase?channel="+channel,{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:restore?"restore-generated":"hide-generated",id:item.id})
   });
   const data=await response.json() as {ok?:boolean;error?:string};
   if(!response.ok||data.ok!==true)throw Error(data.error||"Video konnte nicht verwaltet werden.");
   await load();
   setMessage(upload?"Showcase-Upload endgültig gelöscht.":restore?
    "Video wieder zur Auswahl hinzugefügt (noch nicht veröffentlicht).":
    "Generiertes Video aus allen Bereichen ausgeblendet. Original bleibt sicher gespeichert.");
  }catch(e){setMessage(e instanceof Error?e.message:"Verwaltung fehlgeschlagen");}
  finally{setCleaningId(null)}
 }
 const manageActions=(item:Project)=>(
  <button type="button" disabled={cleaningId!==null||saving||uploading}
   title={item.source==="upload"?"Eigenen Showcase-Upload endgültig löschen":"Generiertes Original behalten, aus der CMS-Auswahl ausblenden"}
   onClick={()=>void manageVideo(item)}
   style={{border:"1px solid #78507f",borderRadius:8,padding:"7px 10px",color:item.source==="upload"?"#ffb8c5":"#eac3ff",background:"#28172f"}}>
   {cleaningId===item.id?"Bitte warten…":item.source==="upload"?"Upload löschen":"Ausblenden"}
  </button>
 );
 const add=(id:string)=>setOrdered(current=>current.includes(id)?current:[...current,id]);
 const remove=(id:string)=>setOrdered(current=>current.filter(x=>x!==id));
 const shift=(i:number,delta:number)=>setOrdered(current=>{
  const dest=i+delta;if(dest<0||dest>=current.length)return current;
  const next=[...current];[next[i],next[dest]]=[next[dest],next[i]];return next;
 });
 const save=async()=>{
  setSaving(true);setMessage("");
  try{
   const res=await fetch("/api/showcase?channel="+channel,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set-list",ids:ordered,randomOrder:channel==="mobile"&&randomOrder})});
   const data=await res.json() as {error?:string};
   if(!res.ok)throw Error(data.error||"Could not save");
   setSaved([...ordered]);setSavedRandomOrder(randomOrder);setMessage("Published successfully for this section.");
  }catch(e){setMessage((e as Error).message);}
  finally{setSaving(false);}
 };
 const name=(id:string)=>available.find(x=>x.id===id)?.name||id;
 const dirty=ordered.join("\n")!==saved.join("\n")||(channel==="mobile"&&randomOrder!==savedRandomOrder);
 return <div className="sm-showcase-cms-manager">
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
     <strong>Unterer CTA-Bereich (Mockup-Wellen)</strong>
     <img src={"/api/showcase-media?kind=final-cta-bg&v="+backgroundRevision} alt="Hintergrund des unteren Create-CTA" style={{width:"100%",height:135,objectFit:"cover",borderRadius:8}}/>
     <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} aria-label="CTA Hintergrund hochladen" onChange={e=>void upload("final-cta-bg",e.target.files?.[0]||null)}/>
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
   {channel==="mobile"&&<label style={{display:"flex",alignItems:"flex-start",gap:12,padding:"13px 14px",border:"1px solid #704c81",borderRadius:10,background:"#21122d",cursor:"pointer"}}>
    <input type="checkbox" checked={randomOrder} onChange={e=>setRandomOrder(e.target.checked)} style={{width:20,height:20,accentColor:"#b34aee",flex:"none"}}/>
    <span><strong>Videos bei jedem Besuch zufällig mischen</strong><small style={{display:"block",marginTop:5,opacity:.8,lineHeight:1.5}}>Nur für den mobilen Feed. Beim nächsten Seitenaufruf startet ein zufällig ausgewähltes veröffentlichtes Video. Während des Scrollens bleibt die Reihenfolge stabil. Zum Aktivieren unten auf „Publish selection &amp; order“ klicken.</small></span>
   </label>}
   {channel==="desktop_portrait"&&<p style={{fontSize:13,color:"#d7b3f5",marginTop:16}}>Stunning Creations: Für jedes Video kannst du unten ein eigenes Vorschaubild hochladen. Empfohlen: Hochkant 9:16, WebP/JPG/PNG bis 5 MiB. Das Vorschaubild bleibt sichtbar, bis das Video geladen ist.</p>}
   <h3 style={{fontSize:16,margin:"22px 0 8px"}}>Published in this section ({ordered.length})</h3>
   {ordered.length===0&&<p style={{fontSize:13}}>No videos published here yet.</p>}
   <ol style={{paddingLeft:28}}>
    {ordered.map((id,i)=><li key={id} style={{padding:"8px 0",borderBottom:"1px solid #ffffff22"}}>
     <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:6}}>
       <span>{name(id)}</span>
       {available.find(x=>x.id===id)&&manageActions(available.find(x=>x.id===id)!)}
       {available.find(x=>x.id===id)?.posterUrl&&<img src={available.find(x=>x.id===id)!.posterUrl!+"&v="+backgroundRevision} alt={"Vorschaubild für "+name(id)} style={{height:72,width:42,objectFit:"contain",background:"#0d0b18",borderRadius:5}}/>}
       {available.find(x=>x.id===id)?.posterUrl&&<button type="button" disabled={posterSaving!==null||uploading} onClick={()=>void deletePoster(id)} aria-label={"Vorschaubild löschen für "+name(id)}>Vorschaubild löschen</button>}
       <label style={{fontSize:12,display:"grid",gap:3,color:"#e8d5f8"}}>Vorschaubild {posterSaving===id?"wird gespeichert…":""}
        <input type="file" aria-label={"Vorschaubild hochladen für "+name(id)} disabled={posterSaving!==null||uploading} accept="image/jpeg,image/png,image/webp" onChange={e=>{void uploadPoster(id,e.target.files?.[0]||null);e.currentTarget.value="";}}/>
       </label>
     </div>
     <span style={{display:"inline-flex",gap:5,marginLeft:15}}>
      <button type="button" disabled={i===0} onClick={()=>shift(i,-1)} aria-label={"Move "+name(id)+" up"}>↑</button>
      <button type="button" disabled={i===ordered.length-1} onClick={()=>shift(i,1)} aria-label={"Move "+name(id)+" down"}>↓</button>
      <button type="button" onClick={()=>remove(id)} aria-label={"Remove "+name(id)}>Remove</button>
     </span>
    </li>)}
   </ol>
   {inventory&&<div style={{border:"1px solid #704c81",borderRadius:10,padding:12,marginTop:16,background:"#21122d",fontSize:13}} role="status">
    <strong>Video-Bestand dieser Umgebung</strong>
    <p style={{margin:"7px 0 2px"}}>Alle Studio-Einträge: {inventory.totalStudioRecords??"–"} · Als Super Admin bestätigt: {inventory.verifiedSuperAdmin??"–"} · Verfügbare fertige Videos: {inventory.completedSuperAdmin} · Eigene Uploads: {inventory.uploadedVideos??0}</p>
    <p style={{margin:"4px 0"}}>Noch nicht fertig / ohne Ausgabe: {inventory.incompleteSuperAdmin??"–"} · Fehlende alte Ausgabe-Einträge: {inventory.missingOutputRecord??"–"} · Ohne überprüfbaren Super-Admin-Nachweis: {inventory.unverifiedLegacy??"–"}</p>
    <p style={{margin:"6px 0 0",opacity:.8}}>Die Auswahl ist nicht auf drei Videos begrenzt. Fehlende alte Produktionen können in einer anderen Umgebung liegen oder noch nicht als sichere Veröffentlichungsquelle erfasst sein. Sie werden nicht automatisch öffentlich gemacht.</p>
   </div>}
   <h3 style={{fontSize:16,margin:"22px 0 8px"}}>Mediathek · verfügbare Videos ({available.length})</h3>
   <p style={{fontSize:12,opacity:.8}}>Nur freigegebene Super-Admin-Generierungen und eigene Showcase-Uploads. Generierte Videos ausblenden oder hochgeladene Testvideos endgültig löschen. Die Auswahl oben bleibt unabhängig davon erhalten.</p>
   <div style={{maxHeight:340,overflowY:"auto",display:"grid",gap:6}}>
    {available.filter(x=>!ordered.includes(x.id)).map(x=><div key={x.id} style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",border:"1px solid #68417d",borderRadius:8,padding:8}}>
      <button type="button" onClick={()=>add(x.id)} style={{textAlign:"left",padding:"10px 12px",borderRadius:8,background:"#2a1739",color:"#fff",border:0,flex:"1 1 170px"}}>+ {x.name}</button>
      {x.posterUrl&&<img src={x.posterUrl+"&v="+backgroundRevision} alt="" style={{width:36,height:60,objectFit:"contain",background:"#0d0b18",borderRadius:4}}/>}
      {x.posterUrl&&<button type="button" disabled={posterSaving!==null||uploading} onClick={()=>void deletePoster(x.id)} aria-label={"Vorschaubild löschen für "+x.name}>Vorschaubild löschen</button>}
      <label style={{fontSize:12,color:"#dfc2f5"}}>Poster wählen
       <input type="file" aria-label={"Vorschaubild hochladen für "+x.name} accept="image/jpeg,image/png,image/webp" disabled={posterSaving!==null||uploading} onChange={e=>{void uploadPoster(x.id,e.target.files?.[0]||null);e.currentTarget.value=""}}/>
      </label>
      {manageActions(x)}
    </div>)}
    {available.length===0&&<p style={{fontSize:13}}>No completed Super Admin videos available in this environment.</p>}
   </div>
   {hiddenVideos.length>0&&<details style={{border:"1px solid #604074",borderRadius:10,padding:12,marginTop:16}}>
    <summary style={{cursor:"pointer",fontWeight:700}}>Ausgeblendete generierte Videos ({hiddenVideos.length})</summary>
    <p style={{fontSize:12}}>Diese Videos sind nicht öffentlich und nicht in der aktiven Auswahl. Die privaten Originaldateien bleiben erhalten.</p>
    <div style={{display:"grid",gap:8,maxHeight:240,overflowY:"auto"}}>
     {hiddenVideos.map(item=><div key={item.id} style={{display:"flex",alignItems:"center",gap:10,justifyContent:"space-between"}}>
      <span>{item.name}</span>
      <button type="button" disabled={cleaningId!==null||saving} onClick={()=>void manageVideo(item,true)}>Wieder anzeigen</button>
     </div>)}
    </div>
   </details>}
   <button type="button" disabled={saving||!dirty} onClick={()=>void save()} style={{marginTop:18,padding:"12px 20px",borderRadius:10,background:"#ad35d9",color:"#fff",border:0,fontWeight:700}}>{saving?"Saving…":"Publish selection & order"}</button>
  </>}
  {message&&<p role="status" style={{marginTop:12,fontSize:13}}>{message}</p>}
 </div>;
}
