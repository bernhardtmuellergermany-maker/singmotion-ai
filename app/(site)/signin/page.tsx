import { ProductHeader } from "@/components/product-header";
import { CustomerAccount } from "@/components/customer-account";
export default function Page() {
  return (
    <div className="product-theme">
      <ProductHeader />
      <main id="content" className="account-content">
        <CustomerAccount />
      </main>
    </div>
  );
}
