"use client";
import {useEffect,useState} from "react";
import {Music2} from "lucide-react";
import type {AudioTip} from "@/lib/audio-quick-tips";

export async function downloadAudioQuickTip(tip:AudioTip){
 const r=await fetch("/api/audio-quick-tips?id="+encodeURIComponent(tip.id),{cache:"no-store"});
 if(!r.ok)throw Error("This audio sample is no longer available.");
 const blob=await r.blob();
 if(!blob.size||blob.size>50*1024*1024||!blob.type.startsWith("audio/"))throw Error("Invalid audio sample.");
 return new File([blob],tip.filename,{type:blob.type});
}
export function AudioQuickTips({disabled,onSelect}:{disabled:boolean;onSelect:(tip:AudioTip)=>Promise<void>}){
 const [tips,setTips]=useState<AudioTip[]>([]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch("/api/audio-quick-tips",{cache:"no-store",signal:controller.signal})
   .then(async r=>{if(r.ok){const data=await r.json();if(!controller.signal.aborted)setTips(Array.isArray(data.tips)?data.tips:[]);}})
   .catch(()=>{});
  return()=>controller.abort();
 },[]);
 if(!tips.length)return null;
 return <section className="sm-performance-ideas" aria-label="Audio Quick Tips">
  <h2>Audio Quick Tips</h2>
  <p>No audio yet? Choose a sample track to try SingMotion.</p>
  <div className="sm-performance-chips" role="group" aria-label="Select a sample audio">
   {tips.map(tip=><button type="button" key={tip.id} disabled={disabled}
    title={tip.description||tip.headline} aria-label={"Use "+tip.headline+" audio sample"}
    onClick={()=>void onSelect(tip)}>
    {tip.emoji?<span aria-hidden="true">{tip.emoji}</span>:<Music2 size={19} aria-hidden="true"/>}
    <span>{tip.headline}{tip.description&&<small style={{display:"block",opacity:.8}}>{tip.description}</small>}</span>
   </button>)}
  </div>
 </section>;
}
