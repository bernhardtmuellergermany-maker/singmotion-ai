"use client";

import {useEffect,useId,useRef,useState} from "react";
import {CheckCircle2,ExternalLink,Link2,Music2} from "lucide-react";
import {normalizeSunoSongLink} from "@/lib/suno-song-link";
import styles from "./suno-song-import.module.css";

type SunoResult={status?:string;error?:string;message?:string;connected?:boolean};
export function SunoSongImport({disabled,onImportFile}:{
 disabled:boolean;
 onImportFile:(file:File)=>Promise<void>;
}){
 const id=useId();
 const linkInput=useRef<HTMLInputElement>(null);
 const [expanded,setExpanded]=useState(false);
 const [focusAfterConnect,setFocusAfterConnect]=useState(false);
 const [link,setLink]=useState("");
 const [connected,setConnected]=useState<boolean|null>(null);
 const [working,setWorking]=useState(false);
 const [needsCredit,setNeedsCredit]=useState(false);
 const [notice,setNotice]=useState("");
 const canonical=normalizeSunoSongLink(link);
 const invalid=link.trim().length>0&&!canonical;

 useEffect(()=>{
  try{
   const saved=sessionStorage.getItem("sm-suno-pending-link");
   if(saved){sessionStorage.removeItem("sm-suno-pending-link");if(normalizeSunoSongLink(saved))setLink(saved);}
   const url=new URL(window.location.href);
   if(url.searchParams.has("suno_connected")||url.searchParams.has("suno_error"))setExpanded(true);
   if(url.searchParams.has("suno_error")){
    const reason=url.searchParams.get("suno_error");
    setNotice(reason==="cancelled"?"Suno sign-in was cancelled.":"Suno sign-in could not be completed. Try connecting again.");
   }else if(url.searchParams.has("suno_connected")){
    setNotice("Connection successful. Paste your Suno song link below and select Import song directly.");
    setFocusAfterConnect(true);
   }
   if(url.searchParams.has("suno_connected")||url.searchParams.has("suno_error")){
    url.searchParams.delete("suno_connected");url.searchParams.delete("suno_error");
    window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
   }
  }catch{/* storage may be disabled; manual link entry is always available */}
 },[]);
 useEffect(()=>{
  if(disabled)return;
  let live=true;
  void fetch("/api/suno-import",{method:"GET",cache:"no-store"})
   .then(async r=>r.ok?await r.json() as SunoResult:{connected:false})
   .then(v=>{if(live)setConnected(v.connected===true);})
   .catch(()=>{if(live)setConnected(false)});
  return()=>{live=false};
 },[disabled]);
 useEffect(()=>{
  if(connected===true&&focusAfterConnect&&expanded&&!disabled){
   linkInput.current?.focus();
   setFocusAfterConnect(false);
  }
 },[connected,focusAfterConnect,expanded,disabled]);

 function connect(){
  if(disabled||working)return;
  try{if(canonical)sessionStorage.setItem("sm-suno-pending-link",canonical)}catch{}
  window.location.assign("/api/suno-import/connect");
 }
 async function importSong(confirmCredit:boolean){
  if(!canonical||disabled||working)return;
  setWorking(true);setNotice("");
  try{
   const r=await fetch("/api/suno-import",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({link:canonical,confirmCredit}),cache:"no-store"
   });
   if(r.ok&&r.headers.get("content-type")?.toLowerCase().startsWith("audio/mpeg")){
    const blob=await r.blob();
    if(!blob.size||blob.size>50*1024*1024)throw Error("Suno returned an invalid file size.");
    const name=r.headers.get("x-suno-audio-filename")||"suno-song.mp3";
    setNeedsCredit(false);
    setNotice("Official Suno MP3 received. Uploading into your private Studio…");
    await onImportFile(new File([blob],name,{type:"audio/mpeg"}));
    return;
   }
   const answer=await r.json() as SunoResult;
   if(answer.status==="requires_credit"){
    setNeedsCredit(true);
    setNotice("Suno requires one download credit. Confirm below only if you want to use it.");
   }else if(answer.status==="processing"){
    setNeedsCredit(false);
    setNotice("Suno is preparing the MP3. Select Import again shortly; no duplicate video generation is started.");
   }else if(answer.status==="connect_required"){
    setConnected(false);
    setNeedsCredit(false);
    setNotice("Your Suno connection expired. Reconnect to import.");
   }else{
    setNeedsCredit(false);
    setNotice(answer.error||answer.message||"Suno could not provide an authorized download.");
   }
  }catch(e){setNotice(e instanceof Error?e.message:"Suno import was interrupted.");}
  finally{setWorking(false);}
 }
 return <details id="suno-import" className={styles.panel} open={expanded}
  onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary className={styles.summary}><Music2 size={20} aria-hidden="true"/>
   <span><strong>Import your Suno song</strong><small>Paste a Suno share link — no manual MP3 download</small></span>
   <span aria-hidden="true" className={styles.plus}>+</span>
  </summary>
  <div className={styles.body}>
   {connected===true&&<p className={styles.connected} role="status"><CheckCircle2 size={18} aria-hidden="true"/> Suno connected — ready to import your song</p>}
   <p className={styles.description}>Connect your own Suno account to import a song directly. Suno may charge one of your download credits for a first-time download; SingMotion will ask you before approving it.</p>
   <label className={styles.label} htmlFor={id}>Suno song link</label>
   <input ref={linkInput} id={id} className={styles.input} type="url" inputMode="url" autoCapitalize="off"
    autoComplete="off" spellCheck={false} placeholder="https://suno.com/s/..."
    value={link} disabled={disabled||working} onChange={e=>{setLink(e.target.value.slice(0,501));setNeedsCredit(false);setNotice("");}}/>
   {invalid&&<p className={styles.error} role="alert">Enter a valid suno.com/s/… or suno.com/song/… link.</p>}
   {canonical&&<p className={styles.ready}>Suno share link recognized.</p>}
   {connected===false&&
    <button type="button" className={styles.open} disabled={disabled||working} onClick={connect}>
     <Link2 size={17} aria-hidden="true"/> Connect Suno to import
    </button>}
   {connected===true&&canonical&&!needsCredit&&
    <button type="button" className={styles.open} disabled={disabled||working} onClick={()=>void importSong(false)}>
     <Music2 size={17} aria-hidden="true"/> {working?"Importing from Suno…":"Import song directly"}
    </button>}
   {connected===true&&canonical&&needsCredit&&
    <button type="button" className={styles.open} disabled={disabled||working} onClick={()=>void importSong(true)}>
     <Music2 size={17} aria-hidden="true"/> {working?"Requesting Suno download…":"Confirm 1 Suno download credit & import"}
    </button>}
   {notice&&<p className={styles.note} role="status">{notice}</p>}
   {canonical&&<a className={styles.link} href={canonical} target="_blank" rel="noopener noreferrer">
     <ExternalLink size={16} aria-hidden="true"/> Open song in Suno
    </a>}
   <p className={styles.note}>Only music you are authorized to download and use.</p>
  </div>
 </details>;
}
