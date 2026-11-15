"use client";

import {useState} from "react";
import {Check,Copy} from "lucide-react";

/** Accessible, standalone prompt copier. No third-party services or analytics. */
export function PromptCopyButton({text,label="Copy prompt"}:{text:string;label?:string}){
 const [status,setStatus]=useState<"idle"|"copied"|"error">("idle");
 async function copy(){
  try{
   await navigator.clipboard.writeText(text);
   setStatus("copied");
  }catch{
   setStatus("error");
  }
 }
 return <button type="button" className="sm-camera-copy" onClick={()=>void copy()}
  aria-label={label+" to clipboard"} title={label}>
  {status==="copied"?<Check size={15} aria-hidden="true"/>:<Copy size={15} aria-hidden="true"/>}
  <span>{status==="copied"?"Copied!":status==="error"?"Copy unavailable":"Copy"}</span>
 </button>;
}
