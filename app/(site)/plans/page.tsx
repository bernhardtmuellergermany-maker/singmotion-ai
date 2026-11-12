import type { Metadata } from "next";
import Link from "next/link";
import { Check, Music2, Sparkles, ShieldCheck, ArrowRight, Clock3, Wallet, Film } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { CreditAmountPicker } from "@/components/credit-amount-picker";
import "./plans.css";

export const metadata: Metadata = {
  title: "AI Music Video Pricing & Credits | SingMotion AI",
  description: "Explore SingMotion AI pricing for AI music performance videos. See example costs, choose prepaid credits without a subscription, and learn how video credits work.",
  alternates: {canonical: "/plans"},
  openGraph: {title: "AI Music Video Pricing & Credits | SingMotion AI",description: "Transparent prepaid credit pricing for AI music performance videos. Explore costs and how credits work.",type: "website"}
};

export default function PlansPage() {
 return <div className="sm-carousel-page sm-plans-page">
  <SiteHeader/>
  <main id="content" className="sm-plans">
   <section className="sm-plans-intro">
    <span className="sm-plans-kicker"><Sparkles size={15}/> YOUR MUSIC. YOUR PERFORMANCE.</span>
    <h1>Pricing<span className="sm-plans-accent">.</span></h1>
    <p>Create AI music performance videos with simple prepaid credits. Understand your costs before you create, choose a credit amount that suits your project, and skip monthly subscriptions.</p>
   </section>
   <div className="sm-plans-preview-notice" role="status"><strong>Pricing preview.</strong> The credit rates below describe the planned model. Live credit purchasing is not available yet.</div>
   <section className="sm-plans-grid sm-plans-grid-single" aria-label="AI music video credit pricing">
    <article className="sm-plan-card sm-plan-featured sm-plan-single">
     <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status sm-plan-soon">Pay as you go</span></div>
     <h2>Bring your music to life. Pay only for what you create.</h2>
     <p className="sm-plan-caption">Turn your music and visuals into an AI-powered performance video. Choose how many credits to add to your wallet — with no monthly plan to manage.</p>
     <div className="sm-plan-price">25 Credits <span>per started second of source audio · planned rate</span></div>
     <p className="sm-plan-price-note">At the planned rate, 1 Credit = €0.01. Your video price is based on the duration of your original audio, not the playback speed.</p>
     <div className="sm-plan-examples" aria-label="Example video credit costs">
      <div><Clock3 size={17}/><span>10 seconds</span><strong>250 Credits <small>€2.50</small></strong></div>
      <div><Clock3 size={17}/><span>30 seconds</span><strong>750 Credits <small>€7.50</small></strong></div>
      <div><Clock3 size={17}/><span>60 seconds</span><strong>1,500 Credits <small>€15.00</small></strong></div>
     </div>
     <div className="sm-plan-rule"/>
     <ul>
      <li><Check size={18}/><span><strong>Know your cost before you create.</strong> Review the credit amount for your selected audio before processing begins.</span></li>
      <li><Check size={18}/><span><strong>Choose your budget.</strong> Pick a popular top-up amount or enter the number of credits you need.</span></li>
      <li><Check size={18}/><span><strong>Pay for a verified result.</strong> Credits are reserved during generation and consumed after validated delivery. Confirmed nonbillable failures release the reservation.</span></li>
     </ul>
     <Link className="sm-plan-action sm-plan-action-outline sm-plan-action-primary" href="/credits#buy-credits">Explore credit wallet <ArrowRight size={17}/></Link>
    </article>
   </section>
   <section className="sm-plans-how" aria-labelledby="sm-pricing-how-title">
    <div className="sm-plans-section-heading">
     <span className="sm-plans-section-eyebrow">SIMPLE FROM START TO FINISH</span>
     <h2 id="sm-pricing-how-title">How do SingMotion AI credits work?</h2>
     <p>A straightforward way to plan your AI music video — from choosing your source audio to receiving the finished performance.</p>
    </div>
    <div className="sm-plans-steps">
     <div><span className="sm-plans-step-icon"><Wallet size={20}/></span><h3>01 · Choose credits</h3><p>Select a preset or enter a custom amount. Your wallet shows your recorded balance and transactions.</p></div>
     <div><span className="sm-plans-step-icon"><Music2 size={20}/></span><h3>02 · Create your performance</h3><p>Use your music and visual inputs to set up an AI performance video. Check the credit cost before submitting.</p></div>
     <div><span className="sm-plans-step-icon"><Film size={20}/></span><h3>03 · Get your video</h3><p>Once generation is complete and the output has been validated, your video can be accessed in your projects.</p></div>
    </div>
   </section>
   <section className="sm-plans-credit-custom" aria-label="Choose proposed credit amount"><CreditAmountPicker/></section>
   <section className="sm-plans-faq" aria-labelledby="sm-pricing-faq-title">
    <div className="sm-plans-section-heading"><span className="sm-plans-section-eyebrow">GOOD TO KNOW</span><h2 id="sm-pricing-faq-title">Pricing questions, answered</h2></div>
    <div className="sm-plans-faq-list">
     <details><summary>Do I need a subscription to use SingMotion AI?</summary><p>No. The planned credit model is prepaid: you choose how much to add to your account. Automatic top-ups are not active.</p></details>
     <details><summary>How is the price of an AI music video calculated?</summary><p>The planned rate is 25 Credits for every started second of original source audio. For example, 10 seconds cost 250 Credits. Slowing down playback does not change the original-audio duration used for the quote.</p></details>
     <details><summary>Can I choose my own credit amount?</summary><p>Yes. The planned wallet supports custom whole-credit amounts from 500 to 100,000, alongside popular packages. The credit selector above shows an estimate before checkout.</p></details>
     <details><summary>What happens if video generation fails?</summary><p>Credits are initially reserved. A verified nonbillable failure releases the reservation. When the provider outcome is uncertain, the reservation remains on hold while it is reviewed rather than being charged twice.</p></details>
    </div>
   </section>
   <div className="sm-plans-footnote"><ShieldCheck size={18}/> Credits are account-bound and cannot be exchanged for cash or transferred. The example prices are provisional, and checkout is subject to availability and applicable consumer protections.</div>
  </main>
 </div>;
}
