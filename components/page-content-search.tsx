"use client";
import {useEffect,useRef,useState} from "react";
import {Search,X} from "lucide-react";

export function PageContentSearch(){
 const [open,setOpen]=useState(false);
 const [query,setQuery]=useState("");
 const [hits,setHits]=useState<HTMLElement[]>([]);
 const [index,setIndex]=useState(-1);
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 useEffect(()=>{
  const root=document.querySelector<HTMLElement>(".sm-legal-main");
  if(!root||!query.trim()){setHits([]);setIndex(-1);return;}
  const needle=query.trim().toLocaleLowerCase();
  const elements=Array.from(root.querySelectorAll<HTMLElement>(".sm-legal-panel h2,.sm-legal-panel p,.sm-legal-panel address,.sm-help-group h2,.sm-help-question summary,.sm-help-question p"));
  setHits(elements.filter(el=>el.textContent?.toLocaleLowerCase().includes(needle)));
  setIndex(-1);
 },[query]);
 function jump(next:number){
  if(!hits.length)return;
  const i=(next+hits.length)%hits.length;
  const el=hits[i];
  const details=el.closest("details");if(details)details.open=true;
  document.querySelectorAll(".sm-search-hit").forEach(node=>node.classList.remove("sm-search-hit"));
  el.classList.add("sm-search-hit");
  el.scrollIntoView({behavior:"smooth",block:"center"});
  setIndex(i);
 }
 function close(){setOpen(false);setQuery("");setIndex(-1);}
 return <div className={"sm-page-search sm-inline-search"+(open?" is-open":"")}>
  <button type="button" className="sm-inline-search-icon" aria-label="Search this page" aria-expanded={open} onClick={()=>{if(open){input.current?.focus();return;}setOpen(true);}}><Search size={19}/></button>
  <input ref={input} type="search" tabIndex={open?0:-1} placeholder="Search this page…" aria-label="Search page content" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();close();}if(e.key==="Enter"){e.preventDefault();jump(e.shiftKey?index-1:index+1);}}}/>
  {open&&query.trim()&&<span className="sm-page-search-count" role="status">{hits.length?(index<0?"0":index+1)+"/"+hits.length:"0"}</span>}
  <button type="button" className="sm-inline-search-close" aria-label="Close search" tabIndex={open?0:-1} onClick={close}><X size={16}/></button>
 </div>;
}
