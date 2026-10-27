import Link from "next/link";
import { ProductHeader } from "./product-header";
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="product-theme unified-app">
      <ProductHeader />
      <nav className="product-workspace-links" aria-label="Workspace">
        <Link href="/studio">Studio</Link>
        <Link href="/projects">My videos</Link>
        <Link href="/artists">My artists</Link>
        <Link href="/billing">Billing</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      <main className="app-main">{children}</main>
      <footer className="wizard-footer">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/help">Help</Link>
      </footer>
    </div>
  );
}
