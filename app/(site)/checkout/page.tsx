import Link from "next/link";
import { ProductHeader } from "@/components/product-header";
export default function Page() {
  return (
    <div className="product-theme">
      <ProductHeader />
      <main id="content" className="account-content wizard-card">
        <h1>Guest checkout</h1>
        <p>
          Guest ordering is being prepared. No payment provider, inclusive sale
          price or email delivery is configured, so checkout is unavailable.
        </p>
        <p>
          You will not be charged and no generation will start. Private operator
          generation remains separate.
        </p>
        <Link href="/signin">Account access</Link>
        <Link href="/studio">Return to your draft</Link>
      </main>
    </div>
  );
}
