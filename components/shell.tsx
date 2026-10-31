import Link from "next/link";
import { ProductHeader } from "./product-header";
import { GlobalMenu } from "./home-collection";
import { UserRound } from "lucide-react";
export function Shell({ children, hideWorkspaceNav = false }: { children: React.ReactNode; hideWorkspaceNav?: boolean }) {
  return (
    <div className="product-theme unified-app">
      {hideWorkspaceNav ? <header className="home-gallery-header sm-carousel-header">
        <Link href="/" className="sm-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link>
        <div className="sm-header-actions"><GlobalMenu /><Link href="/?card=login" className="home-gallery-account" aria-label="Login or account" title="Login or account"><UserRound size={21}/></Link></div>
      </header> : <ProductHeader />}
      {!hideWorkspaceNav && <nav className="product-workspace-links" aria-label="Workspace">
        <Link href="/studio">Studio</Link>
        <Link href="/projects">My videos</Link>
        <Link href="/artists">My artists</Link>
        <Link href="/billing">Billing</Link>
        <Link href="/settings">Settings</Link>
      </nav>}
      <main className="app-main">{children}</main>
      {!hideWorkspaceNav && <footer className="wizard-footer">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/help">Help</Link>
      </footer>}
    </div>
  );
}
