import { ProductHeader } from "@/components/product-header";
import { OperatorLogin } from "@/components/operator-login";
export default function Page() {
  return (
    <div className="product-theme">
      <ProductHeader />
      <main id="content" className="account-content">
        <OperatorLogin />
      </main>
    </div>
  );
}
