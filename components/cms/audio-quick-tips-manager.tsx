"use client";
import {useEffect,useState} from "react";
import type {FormEvent} from "react";
import type {AudioTip} from "@/lib/audio-quick-tips";
import styles from "./audio-quick-tips-manager.module.css";
const endpoint="/api/audio-quick-tips";
function Editor({tip,busy,onSave,onDelete}:{tip?:AudioTip;busy:boolean;onSave:(form:FormData)=>Promise<boolean>;onDelete:(id:string)=>void}){
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const formElement=e.currentTarget;const form=new FormData(formElement);
  if(await onSave(form)&&!tip)formElement.reset();
 }
 return <form className={styles.form} onSubmit={e=>void save(e)}>
  <h2>{tip?"Vorlage bearbeiten":"Neue Audio-Vorlage"}</h2>
  {tip&&<input type="hidden" name="id" value={tip.id}/>}
  <fieldset disabled={busy} className={styles.fields}>
   <label>Headline<input name="headline" required maxLength={120} defaultValue={tip?.headline} placeholder="z. B. Christmas, Birthday, Love"/></label>
   <label>Beschreibung (optional)<textarea name="description" maxLength={300} defaultValue={tip?.description} rows={2}/></label>
   <div className={styles.row}><label>Emoji (optional)<input name="emoji" maxLength={24} defaultValue={tip?.emoji} placeholder="🎄"/></label>
    <label>Reihenfolge<input name="sortOrder" type="number" min={0} max={9999} required defaultValue={tip?.sortOrder??0}/></label></div>
   <label>{tip?"Audio ersetzen (optional)":"Audiodatei (MP3, WAV, M4A · max. 50 MB)"}<input name="file" type="file" required={!tip} accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"/></label>
   {tip&&<p>{tip.filename} · {(tip.size/1024/1024).toFixed(1)} MB · <a href={endpoint+"?manage=1&id="+encodeURIComponent(tip.id)}>Datei herunterladen</a></p>}
   <label className={styles.check}><input type="checkbox" name="active" value="1" defaultChecked={tip?.active===1}/> Für Kunden veröffentlichen</label>
   <p className={styles.hint}>Veröffentliche nur Musik, für die du die Nutzung durch Kunden und die Videogenerierung erlauben darfst.</p>
   <div className={styles.row}><button type="submit">{busy?"Bitte warten…":"Speichern"}</button>{tip&&<button type="button" onClick={()=>onDelete(tip.id)}>Löschen</button>}</div>
  </fieldset>
 </form>;
}
export function AudioQuickTipsManager(){
 const [tips,setTips]=useState<AudioTip[]>([]);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[version,setVersion]=useState(0),[loaded,setLoaded]=useState(false);
 async function refresh(){
  const r=await fetch(endpoint+"?manage=1",{cache:"no-store"});
  if(!r.ok)throw Error("Audio-Vorlagen konnten nicht geladen werden.");
  const data=await r.json();setTips(data.tips);setLoaded(true);setVersion(v=>v+1);
 }
 useEffect(()=>{void refresh().catch(e=>setNotice(e.message));},[]);
 async function save(form:FormData){
  if(busy)return false;setBusy(true);setNotice("");
  try{
   const r=await fetch(endpoint,{method:"POST",body:form});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Speichern fehlgeschlagen.");
   await refresh();setNotice("Vorlage gespeichert.");return true;
  }catch(e){setNotice(e instanceof Error?e.message:"Speichern fehlgeschlagen.");return false;}
  finally{setBusy(false);}
 }
 async function remove(id:string){
  if(busy||!window.confirm("Diese Vorlage aus der Audio-Bibliothek löschen? Bereits importierte Kundenprojekte bleiben unverändert."))return;
  setBusy(true);setNotice("");
  try{
   const r=await fetch(endpoint+"?id="+encodeURIComponent(id),{method:"DELETE"});
   if(!r.ok)throw Error("Löschen fehlgeschlagen.");
   await refresh();setNotice("Vorlage gelöscht.");
  }catch(e){setNotice(e instanceof Error?e.message:"Löschen fehlgeschlagen.");}
  finally{setBusy(false);}
 }
 return <div className={styles.manager}>
  {notice&&<p role="status">{notice}</p>}
  {loaded?<><Editor key={"new-"+version} busy={busy} onSave={save} onDelete={id=>void remove(id)}/>
   <h2>Vorhandene Vorlagen ({tips.length})</h2>
   {!tips.length&&<p>Noch keine Audio-Vorlagen. Lade deine erste Datei hoch.</p>}
   {tips.map(tip=><Editor key={tip.id+"-"+version} tip={tip} busy={busy} onSave={save} onDelete={id=>void remove(id)}/>)}</>:<p>Audio-Bibliothek wird geladen…</p>}
 </div>;
}
