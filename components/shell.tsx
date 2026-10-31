import Link from "next/link";
import { ProductHeader } from "./product-header";
import { GlobalMenu } from "./home-collection";
import { UserRound, Search } from "lucide-react";
import { ProjectHeaderName } from "./project-header-name";
export function Shell({ children, hideWorkspaceNav = false, projectId }: { children: React.ReactNode; hideWorkspaceNav?: boolean; projectId?: string }) {
  if (hideWorkspaceNav) return (
    <div className="sm-carousel-page sm-output-page">
      <header className="home-gallery-header sm-carousel-header sm-output-header">
        <div className="sm-output-header-left">
          <Link href="/" className="sm-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link>
          {projectId && <><span className="flow-divider"/><ProjectHeaderName id={projectId}/></>}
        </div>
        <div className="sm-header-actions sm-output-header-right">
          <Link href="/?search=1" className="sm-output-search" aria-label="Search projects"><Search size={19}/></Link>
          <GlobalMenu />
          <Link href="/?card=login" className="home-gallery-account" aria-label="Login or account"><UserRound size={21}/></Link>
        </div>
      </header>
      <main className="sm-carousel-main">{children}</main>
    </div>
  );
  return (
    <div className="product-theme unified-app">
      <ProductHeader />
      <nav className="product-workspace-links" aria-label="Workspace">
        <Link href="/studio">Studio</Link><Link href="/projects">My videos</Link>
        <Link href="/artists">My artists</Link><Link href="/billing">Billing</Link><Link href="/settings">Settings</Link>
      </nav>
      <main className="app-main">{children}</main>
      <footer className="wizard-footer"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/help">Help</Link></footer>
    </div>
  );
}
