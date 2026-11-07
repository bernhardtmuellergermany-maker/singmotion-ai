import { ProductHeader } from "@/components/product-header";
import { CustomerAccount } from "@/components/customer-account";
import Link from "next/link";
export default function Page() {
  return (
    <div className="product-theme">
      <ProductHeader />
      <main id="content" className="account-content">
        <p>
          <Link href="/operator-signin">Private operator sign in</Link>
        </p>
        <CustomerAccount />
      </main>
    </div>
  );
}
