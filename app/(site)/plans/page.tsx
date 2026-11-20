import type { Metadata } from "next";
import Link from "next/link";
import { Check, Music2, Sparkles, ShieldCheck, ArrowRight, Wallet, Film } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { CreditAmountPicker } from "@/components/credit-amount-picker";
import {CampaignPricingBanner,CurrentVideoRate} from "@/components/campaign-display";
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
   <CampaignPricingBanner placement="pricing"/>
   <section className="sm-plans-grid sm-plans-grid-single" aria-label="AI music video credit pricing">
    <article className="sm-plan-card sm-plan-featured sm-plan-single">
     <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status sm-plan-soon">Pay as you go</span></div>
     <h2>Bring your music to life. Pay only for what you create.</h2>
     <p className="sm-plan-caption">Turn your music and visuals into an AI-powered performance video. Choose how many credits to add to your wallet — with no monthly plan to manage.</p>
     <CurrentVideoRate/>
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
     <p>From your first idea to the finished AI music performance video: three easy steps, transparent credits and room to create something unmistakably yours.</p>
    </div>
    <div className="sm-plans-steps">
     <article className="sm-plans-step">
      <span className="sm-plans-step-icon"><Wallet size={20}/></span>
      <span className="sm-plans-step-number">STEP 01</span>
      <h3>Choose your credits. Keep control of your budget.</h3>
      <p>Start with the amount that fits your next music video. Choose a ready-made credit package or enter a custom amount — without committing to a monthly subscription.</p>
      <p>Your SingMotion AI wallet keeps your credit balance and transaction history in one place, so you can plan your next creative project with a clear view of your budget.</p>
      <div className="sm-plans-step-highlight"><Check size={16}/> Pick the amount that works for you</div>
     </article>
     <article className="sm-plans-step">
      <span className="sm-plans-step-icon"><Music2 size={20}/></span>
      <span className="sm-plans-step-number">STEP 02</span>
      <h3>Turn your song into an AI music performance.</h3>
      <p>Bring together your audio, your visual source and your creative direction in the SingMotion AI Studio. Set up a performance that reflects the mood and energy of your music.</p>
      <p>Before generation, see the credit cost calculated from your original audio length. That means you know the planned price before you submit your AI music video.</p>
      <div className="sm-plans-step-highlight"><Check size={16}/> See your credit cost before creating</div>
     </article>
     <article className="sm-plans-step">
      <span className="sm-plans-step-icon"><Film size={20}/></span>
      <span className="sm-plans-step-number">STEP 03</span>
      <h3>Enjoy your finished performance video.</h3>
      <p>When your AI-generated performance is complete and the result passes validation, you can open the finished video in Videos and enjoy seeing your music take shape on screen.</p>
      <p>Credits are reserved while the video is being processed and used only after validated delivery. If a confirmed nonbillable generation failure occurs, the reserved credits are released.</p>
      <div className="sm-plans-step-highlight"><Check size={16}/> Your work stays organized in Videos</div>
     </article>
    </div>
   </section>
   <section className="sm-plans-credit-custom" aria-label="Choose proposed credit amount"><CreditAmountPicker discoverAvailability/></section>
   <section className="sm-plans-faq" aria-labelledby="sm-pricing-faq-title">
    <div className="sm-plans-section-heading"><span className="sm-plans-section-eyebrow">GOOD TO KNOW</span><h2 id="sm-pricing-faq-title">Pricing questions, answered</h2></div>
    <div className="sm-plans-faq-list">
     <details><summary>Do I need a subscription to use SingMotion AI?</summary><p>No. The planned credit model is prepaid: you choose how much to add to your account. Automatic top-ups are not active.</p></details>
     <details><summary>How is the price of an AI music video calculated?</summary><p>The active rate per started second is shown in the pricing card above. For a 10-second excerpt, multiply that rate by 10. Studio confirms the current server-side price before generation. Slowing playback does not change the priced original audio duration.</p></details>
     <details><summary>Can I choose my own credit amount?</summary><p>Yes. The planned wallet supports custom whole-credit amounts from 500 to 100,000, alongside popular packages. The credit selector above shows an estimate before checkout.</p></details>
     <details><summary>What happens if video generation fails?</summary><p>Credits are initially reserved. A verified nonbillable failure releases the reservation. When the provider outcome is uncertain, the reservation remains on hold while it is reviewed rather than being charged twice.</p></details>
    </div>
   </section>
   <div className="sm-plans-footnote"><ShieldCheck size={18}/> Credits are account-bound and cannot be exchanged for cash or transferred. Displayed generation costs use the verified active rate. Checkout remains subject to eligibility and applicable consumer protections.</div>
  </main>
 </div>;
}
