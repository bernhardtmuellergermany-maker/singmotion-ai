"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  House,
  FolderOpen,
  Star,
  CreditCard,
  Settings,
  CircleHelp,
  UserRound,
  ArrowUpRight,
} from "lucide-react";
import { Brand } from "./brand";
import { api, ensureSession } from "@/lib/client";
import { money } from "@/lib/domain";
const links = [
  ["/studio", "Studio", House],
  ["/projects", "My Projects", FolderOpen],
  ["/artists", "My Artists", Star],
  ["/billing", "Billing", CreditCard],
] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      ensureSession()
        .then(() => api<{ balance: number }>("session"))
        .then((r) => {
          if (alive) setBalance(r.balance);
        })
        .catch(() => {});
    refresh();
    window.addEventListener("credits-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("credits-changed", refresh);
    };
  }, []);
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <div className="header-right">
          <span className="demo-badge">Demo workspace</span>
          <Link href="/billing" className="credit-label">
            Demo credits{" "}
            <strong>{balance === null ? "—" : money(balance)}</strong>
          </Link>
          <Link
            href="/settings"
            className="avatar"
            aria-label="Account settings"
          >
            <UserRound size={21} />
          </Link>
        </div>
      </header>
      <aside className="sidebar">
        <nav aria-label="Main navigation">
          {links.map(([href, label, Icon]) => (
            <Link
              href={href}
              key={href}
              className={
                pathname.startsWith(href) ? "nav-link active" : "nav-link"
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="eyebrow">A LITTLE INSPIRATION</span>
            <p>
              Your music.
              <br />
              Your artist.
              <br />
              Your performance.
            </p>
            <Link href="/help">
              Make something yours <ArrowUpRight size={14} />
            </Link>
          </div>
          <Link href="/settings" className="nav-link">
            <Settings size={19} />
            <span>Settings</span>
          </Link>
          <Link href="/help" className="nav-link">
            <CircleHelp size={19} />
            <span>Help & Tips</span>
          </Link>
        </div>
      </aside>
      <main className="app-main">{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {links.map(([href, label, Icon]) => (
          <Link
            href={href}
            key={href}
            className={pathname.startsWith(href) ? "active" : ""}
          >
            <Icon size={20} />
            <span>{label.replace("My ", "")}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
