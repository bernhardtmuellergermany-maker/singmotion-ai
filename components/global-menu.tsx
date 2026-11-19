"use client";
import {useEffect,useRef,useState} from "react";
import {readCustomerAuthStatus} from "@/lib/client-auth-status";
import Link from "next/link";
import {MoreVertical} from "lucide-react";
export function GlobalMenu({ openInNewTab = false }: { openInNewTab?: boolean } = {}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [musicEnabled,setMusicEnabled]=useState(false);
  useEffect(()=>{
    let active=true;
    void readCustomerAuthStatus().then(async auth=>{
      if(auth?.staffRole==="super-admin"){if(active)setMusicEnabled(true);return;}
      if(auth?.authenticated&&auth.kind==="customer"){
        const r=await fetch("/api/music-video",{credentials:"same-origin",cache:"no-store"}).catch(()=>null);
        if(active)setMusicEnabled(!!r?.ok);
      }
    });
    return()=>{active=false;};
  },[]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current) menu.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, []);
  return <details ref={menu} className="sm-global-menu">
    <summary aria-label="More options" title="More options"><MoreVertical size={19}/></summary>
    <nav className="sm-global-menu-list" aria-label="More options">
      {musicEnabled&&<Link href="/projects" target={openInNewTab?"_blank":undefined} rel={openInNewTab?"noopener noreferrer":undefined} onClick={()=>{if(menu.current)menu.current.open=false;}}>Projects</Link>}
      {([
        { href: "/videos", label: "Videos" },
        { href: "/help", label: "Help" },
        { href: "/legal", label: "Legals" },
        { href: "/contact", label: "Contact" }
      ] as const).map(item => (
        <Link key={item.href} href={item.href} target={openInNewTab ? "_blank" : undefined} rel={openInNewTab ? "noopener noreferrer" : undefined} onClick={() => { if (menu.current) menu.current.open = false; }}>{item.label}</Link>
      ))}
    </nav>
  </details>;
}
