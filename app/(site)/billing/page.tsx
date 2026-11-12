import type {Metadata} from "next";
import Link from "next/link";
import {Shell} from "@/components/shell";
export const metadata:Metadata={title:"Billing & Credits — SingMotion AI"};
export default function Page(){
 return <Shell><main style={{width:"min(100%,900px)",margin:"38px auto 90px",padding:"0 24px",color:"#f7f3ff"}}>
  <span style={{fontSize:11,letterSpacing:".16em",color:"#c4afff",fontWeight:750}}>SINGMOTION AI · BILLING</span>
  <h1 style={{fontSize:"clamp(33px,5vw,48px)",letterSpacing:"-.045em",margin:"16px 0"}}>Credits & payments</h1>
  <p style={{color:"#bdb3cb",lineHeight:1.75,maxWidth:670}}>Buy prepaid credits when Stripe Checkout is available, track usage and download issued invoices. No new Hobby subscriptions are offered.</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:18,margin:"30px 0"}}>
   <section style={{border:"1px solid #5e4775",borderRadius:18,padding:24,background:"linear-gradient(145deg,#211632,#151629)"}}>
    <h2 style={{fontSize:19,margin:"0 0 9px"}}>Credit wallet</h2>
    <p style={{color:"#c5b8d7",lineHeight:1.65}}>Your balance, one-time credit purchases, optional top-up preferences and transaction history.</p>
    <Link href="/credits" style={{color:"#e4c2ff",fontWeight:700}}>Open credit wallet</Link>
   </section>
   <section style={{border:"1px solid #5e4775",borderRadius:18,padding:24,background:"linear-gradient(145deg,#211632,#151629)"}}>
    <h2 style={{fontSize:19,margin:"0 0 9px"}}>Invoices & billing settings</h2>
    <p style={{color:"#c5b8d7",lineHeight:1.65}}>Access issued Stripe documents and manage your account. Existing legacy subscription contracts remain manageable there.</p>
    <Link href="/account/settings#billing" style={{color:"#e4c2ff",fontWeight:700}}>Account payments</Link>
   </section>
  </div>
 </main></Shell>;
}
