import Link from "next/link";
import { GlobalMenu } from "@/components/home-collection";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";

export const metadata = { title: "Login · SingMotion AI" };

export default function LoginPage() {
  return (
    <div className="sm-login-page">
      <header className="sm-login-header">
        <Link href="/" className="sm-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link>
        <div className="sm-header-actions"><GlobalMenu /><Link href="/login" className="home-gallery-account" aria-label="Login or account" title="Login or account"><UserRound size={21}/></Link></div>
      </header>
      <main id="content" className="sm-login-main">
        <div className="sm-login-art">
          <div className="sm-login-ghost sm-login-ghost-left" aria-hidden="true"/>
          <div className="sm-login-ghost sm-login-ghost-right" aria-hidden="true"/>
          <section className="sm-login-card" aria-labelledby="sm-login-title">
            <span className="sm-login-icon" aria-hidden="true"><LockKeyhole size={24} strokeWidth={1.7}/></span>
            <h1 id="sm-login-title">Welcome back</h1>
            <p>Your private music video workspace.</p>
            <div className="sm-login-notice">Email sign-in is not active yet. Your projects are currently linked to this browser's private demo session.</div>
            <Link href="/" className="sm-login-action">Continue to workspace <ArrowRight size={17}/></Link>
          </section>
        </div>
      </main>
    </div>
  );
}
