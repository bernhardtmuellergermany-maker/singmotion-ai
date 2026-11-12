import type { Metadata } from "next";
import Link from "next/link";
import { Check, Music2, Sparkles, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { CreditAmountPicker } from "@/components/credit-amount-picker";
import "./plans.css";

export const metadata: Metadata = {
  title: "Pricing — SingMotion AI",
  description: "SingMotion AI prepaid credit pricing: choose preset amounts or enter your own number of credits. Purchases are not yet enabled."
};

export default function PlansPage() {
 return <div className="sm-carousel-page sm-plans-page">
  <SiteHeader/>
  <main id="content" className="sm-plans">
   <section className="sm-plans-intro">
    <span className="sm-plans-kicker"><Sparkles size={15}/> YOUR MUSIC. YOUR PERFORMANCE.</span>
    <h1>Pricing<span className="sm-plans-accent">.</span></h1>
    <p>One simple model: top up your account with the credits you choose, then use them to create AI performance videos. No new subscription or monthly fee.</p>
   </section>
   <div className="sm-plans-preview-notice" role="status"><strong>Credit payments are being prepared.</strong> These rates and amounts explain the proposed model. On staging, account holders can try Stripe Test Checkout from the Credits page. Live credit purchases and credit-paid videos are not enabled.</div>
   <section className="sm-plans-grid sm-plans-grid-single" aria-label="Pay-as-you-go credit pricing">
    <article className="sm-plan-card sm-plan-featured sm-plan-single">
     <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status sm-plan-soon">Pay as you go</span></div>
     <h2>One simple price. Your music, your way.</h2>
     <p className="sm-plan-caption">Buy credits only when you need them. No monthly subscription or automatic charges.</p>
     <div className="sm-plan-price">25 Credits <span>/ started source-audio second · proposed</span></div>
     <p className="sm-plan-price-note">1 Credit = €0.01 · 10 seconds of source audio = 250 Credits (€2.50). Costs depend on the original source duration, not the playback speed.</p>
     <div className="sm-plan-rule"/>
     <ul>
      <li><Check size={18}/> See the exact credit cost before generation</li>
      <li><Check size={18}/> Choose a credit package or enter your own amount</li>
      <li><Check size={18}/> Credits are charged only after verified delivery; confirmed nonbillable failures release reserved credits</li>
     </ul>
     <Link className="sm-plan-action sm-plan-action-outline" href="/credits#buy-credits">Open credit wallet</Link>
    </article>
   </section>
   <section className="sm-plans-credit-custom" aria-label="Choose proposed credit amount"><CreditAmountPicker/></section>
   <div className="sm-plans-footnote"><ShieldCheck size={18}/> Credits are account-bound internal video credits, not cash or transferable funds. Euro refunds, withdrawal rights and statutory consumer protections remain separate. Rates, taxes and limits require approval before launch. The account wallet records actual purchases and video credit usage.</div>
  </main>
 </div>;
}
