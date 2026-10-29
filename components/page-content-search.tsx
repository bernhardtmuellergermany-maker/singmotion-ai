"use client";
import {useEffect,useRef,useState} from "react";
import {Search,X} from "lucide-react";
export function PageContentSearch(){
 const [open,setOpen]=useState(false);
 const [query,setQuery]=useState("");
 const [hits,setHits]=useState<{text:string;target:HTMLElement}[]>([]);
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 useEffect(()=>{
  const root=document.querySelector<HTMLElement>(".sm-legal-main");
  if(!root||!query.trim()){setHits([]);return;}
  const needle=query.trim().toLocaleLowerCase();
  const elements=Array.from(root.querySelectorAll<HTMLElement>(".sm-legal-panel h2,.sm-legal-panel p,.sm-legal-panel address,.sm-help-group h2,.sm-help-question summary,.sm-help-question p"));
  setHits(elements.filter(el=>el.textContent?.toLocaleLowerCase().includes(needle)).slice(0,30).map(el=>({text:(el.textContent||"").trim().slice(0,115),target:el})));
 },[query]);
 function jump(el:HTMLElement){
  const details=el.closest("details");if(details)details.open=true;
  el.scrollIntoView({behavior:"smooth",block:"center"});
  el.classList.add("sm-search-hit");
  window.setTimeout(()=>el.classList.remove("sm-search-hit"),1800);
  setOpen(false);setQuery("");
 }
 return <div className={"sm-page-search"+(open?" is-open":"")}>
  <button type="button" className="sm-legal-search" aria-label="Search this page" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Search size={19}/></button>
  {open&&<div className="sm-page-search-panel"><div className="sm-page-search-field"><input ref={input} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setOpen(false);if(e.key==="Enter"&&hits[0])jump(hits[0].target)}} type="search" placeholder="Search this page…" aria-label="Search page content"/><button type="button" aria-label="Close search" onClick={()=>{setOpen(false);setQuery("");}}><X size={17}/></button></div>{query.trim()&&<div className="sm-page-search-results" role="listbox">{hits.length?hits.map((hit,i)=><button type="button" role="option" aria-selected={false} key={i} onClick={()=>jump(hit.target)}>{hit.text}</button>):<p>No matching text found.</p>}</div>}</div>}
 </div>;
}
