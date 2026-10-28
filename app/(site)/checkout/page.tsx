import Link from "next/link";
import { ProductHeader } from "@/components/product-header";
import { customerLaunchReadiness } from "@/lib/commerce/readiness";
export const dynamic = "force-dynamic";
export const metadata = { title: "SingMotion · Checkout", robots: { index: false, follow: false } };
export default function Page() {
  const readiness = customerLaunchReadiness();
  return (
    <div className="product-theme">
      <ProductHeader />
      <main id="content" className="account-content wizard-card">
        <h1>Make your music move.</h1>
        <p>Upload your song and a licensed reference image, choose the performance and review your video before placing an order.</p>
        {!readiness.readyForPaidOrders ? (
          <section role="status" aria-label="Ordering status">
            <h2>Checkout is not open yet</h2>
            <p>Customer orders, payments and paid AI generation are unavailable. No charge will be made and no provider job will be created.</p>
            <p>We are preparing secure payment, order processing, and private video delivery for customers.</p>
          </section>
        ) : null}
        <p><Link href="/studio">Prepare a video in Studio</Link></p>
        <p><Link href="/signin">Customer account</Link> · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link></p>
      </main>
    </div>
  );
}
