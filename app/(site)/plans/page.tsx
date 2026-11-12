import type { Metadata } from "next";
import Link from "next/link";
import { Check, Music2, Sparkles, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import "./plans.css";

export const metadata: Metadata = {
  title: "Plans & Pricing — SingMotion AI",
  description: "SingMotion AI prepaid credit pricing information. Credit checkout is not yet available."
};

const packages = [
  { euro: 20, credits: "2,000" },
  { euro: 40, credits: "4,000" },
  { euro: 100, credits: "10,000" }
];

export default function PlansPage() {
 return <div className="sm-carousel-page sm-plans-page">
  <SiteHeader/>
  <main id="content" className="sm-plans">
   <section className="sm-plans-intro">
    <span className="sm-plans-kicker"><Sparkles size={15}/> YOUR MUSIC. YOUR PERFORMANCE.</span>
    <h1>Plans & Pricing<span className="sm-plans-accent">.</span></h1>
    <p>Choose your music. Choose your performance. The proposed new billing model uses prepaid credits in your personal SingMotion AI account, rather than a separate payment for every video.</p>
   </section>
   <div className="sm-plans-preview-notice" role="status"><strong>Credit payments are coming soon.</strong> This page explains the proposed model. Credit purchases and credit-based generation are not available yet. No payment is taken here.</div>
   <section className="sm-plans-grid" aria-label="Pricing information">
    <article className="sm-plan-card sm-plan-featured">
     <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status sm-plan-soon">Prepaid · planned</span></div>
     <h2>Pay with Credits</h2>
     <p className="sm-plan-caption">No subscription. Load credit into your account once and use it for videos when generation is enabled.</p>
     <div className="sm-plan-price">25 Credits <span>/ billable video second · planned</span></div>
     <p className="sm-plan-price-note">1 Credit = €0.01 of internal video credit. Example: 10 seconds = 250 Credits (€2.50), 30 seconds = 750 Credits (€7.50). All prices include VAT.</p>
     <div className="sm-plan-rule"/>
     <ul>
      <li><Check size={18}/> An account and enough available credits are required before video generation.</li>
      <li><Check size={18}/> Credits are reserved before BytePlus processing and consumed only for a verified delivered result.</li>
      <li><Check size={18}/> A confirmed provider rejection or technical failure releases the reserved credits.</li>
      <li><Check size={18}/> Uncertain provider jobs remain reserved while the result is reviewed.</li>
      <li><Check size={18}/> The final charge is shown before starting generation; no silent price increases.</li>
     </ul>
     <Link className="sm-plan-action sm-plan-action-outline" href="/credits">View credit packages</Link>
    </article>
    <article className="sm-plan-card">
     <div className="sm-plan-top"><span className="sm-plan-icon"><Sparkles size={24}/></span><span className="sm-plan-status sm-plan-soon">Coming soon</span></div>
     <h2>Hobby</h2>
     <p className="sm-plan-caption">The existing proposed subscription model will be evaluated for compatibility with the credit wallet.</p>
     <div className="sm-plan-price">€4.99 <span>/ month · incl. VAT · proposed</span></div>
     <p className="sm-plan-price-note">Planned: 30 included video seconds per paid billing period; additional seconds €0.20 each. Existing entitlements must be preserved during migration.</p>
     <div className="sm-plan-rule"/>
     <ul>
      <li><Check size={18}/> Unlimited projects · proposed 2 GB upload storage</li>
      <li><Check size={18}/> Separate subscription allowance, not mixed with purchased credits</li>
      <li><Check size={18}/> Clear renewal and cancellation terms before activation</li>
      <li><Check size={18}/> No subscription purchase is available on this page</li>
     </ul>
     <span className="sm-plan-action sm-plan-action-disabled" aria-disabled="true">Subscriptions not available</span>
    </article>
   </section>
   <section className="sm-plans-credit-packages" aria-label="Proposed credit top-up amounts">
    <div className="sm-plans-credit-header"><h2>Credit packages</h2><p>One-time top-ups for your account · proposed amounts, not purchasable yet.</p></div>
    <div className="sm-plans-package-grid">{packages.map((pack)=>
     <div key={pack.euro} className="sm-plans-package"><strong>€{pack.euro}</strong><span>{pack.credits} Credits</span></div>
    )}</div>
    <p>Additional custom amounts and optional automatic top-ups are under consideration. Auto top-up will be off by default and require explicit consent and spending limits.</p>
    <Link href="/login" className="sm-plans-login-link">Sign in or create an account</Link>
   </section>
   <div className="sm-plans-footnote"><ShieldCheck size={18}/> Credits would be account-bound, non-transferable internal video credits, not cash. Euro refunds, withdrawal rights and statutory consumer protections remain separate. Final tariffs, taxes and rules require approval before launch.</div>
  </main>
 </div>;
}
