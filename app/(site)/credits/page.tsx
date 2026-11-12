import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { CreditsDashboard } from "@/components/credits-dashboard";
import "./credits.css";

export const metadata: Metadata = {
  title: "Credits — SingMotion AI",
  description: "View your available credits and upcoming prepaid credit packages.",
};

export default function CreditsPage() {
  return <div className="sm-carousel-page sm-plans-page sm-credits-page">
    <SiteHeader/>
    <main id="content" className="sm-credits-main">
      <header className="sm-credits-intro"><span className="sm-plans-kicker">SINGMOTION AI · ACCOUNT</span>
        <h1>Your credits<span>.</span></h1>
        <p>Pay for video generation from your account balance. Credits are reserved before processing and released when a provider failure is confirmed.</p>
      </header>
      <CreditsDashboard mode="buy"/>
    </main>
  </div>;
}
