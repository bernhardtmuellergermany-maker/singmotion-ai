import type {Metadata} from "next";
import Link from "next/link";
import {Check, Music2, Sparkles, ShieldCheck} from "lucide-react";
import {SiteHeader} from "@/components/site-header";
import "./plans.css";
export const metadata:Metadata={
 title:"Plans & Pricing — SingMotion AI",
 description:"SingMotion AI pricing: no subscription with pay-per-second video generation, or Hobby at €4.99 per month with 30 included seconds."
};
export default function PlansPage(){
 return <div className="sm-carousel-page sm-plans-page">
  <SiteHeader />
  <main className="sm-plans">
  <div className="sm-plans-glow" aria-hidden="true"/>
  <section className="sm-plans-intro">
   <span className="sm-plans-kicker"><Sparkles size={15}/> YOUR MUSIC. YOUR PERFORMANCE.</span>
   <h1>Find your rhythm.</h1>
   <p>Choose how you pay for AI video generation: per second without a subscription, or with a Hobby subscription that includes 30 video seconds each billing period.</p>
  </section>
  <section className="sm-plans-grid" aria-label="Compare subscriptions">
   <article className="sm-plan-card">
    <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status">Account available</span></div>
    <h2>Pay as you go</h2><p className="sm-plan-caption">No subscription. Create unlimited projects; pay when you generate a video.</p>
    <div className="sm-plan-price">€0.25 <span>/ generated video second · incl. VAT</span></div><p className="sm-plan-price-note">No monthly fee. Example: 10 seconds cost €2.50; 30 seconds cost €7.50.</p>
    <div className="sm-plan-rule"/>
    <ul><li><Check size={18}/> Unlimited projects · 250 MB upload storage</li><li><Check size={18}/> No subscription or monthly charge</li><li><Check size={18}/> No free video generation included</li><li><Check size={18}/> Video generation is charged separately by the second</li><li><Check size={18}/> 5–300 seconds per video</li></ul>
    <Link className="sm-plan-action sm-plan-action-outline" href="/">Create account without a subscription</Link>
   </article>
   <article className="sm-plan-card sm-plan-featured">
    <div className="sm-plan-top"><span className="sm-plan-icon"><Sparkles size={24}/></span><span className="sm-plan-status sm-plan-soon">Coming soon</span></div>
    <h2>Hobby</h2><p className="sm-plan-caption">Subscription with 30 included video seconds per paid billing period.</p>
    <div className="sm-plan-price">€4.99 <span>/ month · incl. VAT</span></div><p className="sm-plan-price-note">30 seconds included; extra seconds cost €0.20 each (incl. VAT).</p>
    <div className="sm-plan-rule"/>
    <ul><li><Check size={18}/> Unlimited projects · 2 GB upload storage</li><li><Check size={18}/> 30 video seconds included per paid billing period</li><li><Check size={18}/> 5–300 seconds per video</li><li><Check size={18}/> Extra video seconds after your allowance: €0.20 per second (VAT included)</li></ul>
    <span className="sm-plan-action sm-plan-action-disabled" aria-disabled="true">Subscriptions coming soon</span>
   </article>
  </section>
  <div className="sm-plans-footnote"><ShieldCheck size={18}/> Creating an account without a subscription is free, but AI video generation is not free. The price depends on the charged video seconds and is shown before purchase; no generation is charged without a separate payment step. Hobby is not available for purchase yet. Its 30 included seconds reset each paid billing period; for example, they cover up to six 5-second videos. Additional seconds are charged separately. All displayed prices include VAT.</div>
  
 </main></div>;
}
