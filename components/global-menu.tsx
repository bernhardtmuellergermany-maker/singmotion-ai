"use client";
import {useEffect,useRef} from "react";
import Link from "next/link";
import {MoreVertical} from "lucide-react";
export function GlobalMenu({ openInNewTab = false }: { openInNewTab?: boolean } = {}) {
  const menu = useRef<HTMLDetailsElement>(null);
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
      {([
        { href: "/plans", label: "Plans & Pricing" },
        { href: "/help", label: "Help & FAQ" },
        { href: "/contact", label: "Contact & Support" },
        { href: "/legal", label: "Imprint / Legal Notice" },
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/cookies", label: "Cookies & Tracking" },
        { href: "/terms", label: "Terms of Service" },
        { href: "/withdrawal", label: "Withdrawal Rights" },
        { href: "/rights", label: "Music, Image & Voice Rights" },
        { href: "/ai-transparency", label: "AI Transparency" }
      ] as const).map(item => (
        <Link key={item.href} href={item.href} target={openInNewTab ? "_blank" : undefined} rel={openInNewTab ? "noopener noreferrer" : undefined} onClick={() => { if (menu.current) menu.current.open = false; }}>{item.label}</Link>
      ))}
    </nav>
  </details>;
}
