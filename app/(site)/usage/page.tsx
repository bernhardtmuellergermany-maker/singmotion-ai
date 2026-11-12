import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { CreditsDashboard } from "@/components/credits-dashboard";
import "../credits/credits.css";

export const metadata: Metadata = {
  title: "Usage — SingMotion AI",
  description: "Your private account credit balance and usage history.",
};

export default function UsagePage() {
  return <div className="sm-carousel-page sm-plans-page sm-credits-page">
    <SiteHeader/>
    <main id="content" className="sm-credits-main">
      <header className="sm-credits-intro"><span className="sm-plans-kicker">SINGMOTION AI · ACCOUNT</span>
        <h1>Usage<span>.</span></h1>
        <p>Review your account credit balance and recorded transactions.</p>
      </header>
      <CreditsDashboard mode="usage"/>
    </main>
  </div>;
}
