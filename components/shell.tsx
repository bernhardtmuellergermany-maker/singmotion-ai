"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { House, FolderOpen, Star, CreditCard, UserRound } from "lucide-react";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
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
    <div className="unified-app">
      <SiteHeader
        navigation={
          <nav className="app-navigation" aria-label="Main navigation">
            {links.map(([href, label, Icon]) => (
              <Link
                href={href}
                key={href}
                aria-current={pathname.startsWith(href) ? "page" : undefined}
                className={pathname.startsWith(href) ? "active" : ""}
              >
                <Icon size={19} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        }
        actions={
          <>
            <span className="demo-badge header-demo">Demo workspace</span>
            <Link href="/billing" className="header-credits">
              <span>Demo credits</span>
              <strong>{balance === null ? "—" : money(balance)}</strong>
            </Link>
            <Link
              href="/settings"
              className="header-profile"
              aria-label="Account settings"
            >
              <UserRound size={22} />
            </Link>
          </>
        }
      />
      <main className="app-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
