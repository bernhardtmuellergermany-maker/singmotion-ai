import { Shell } from "@/components/shell";
import { CustomerAccount } from "@/components/customer-account";
export default function Page() {
  return (
    <Shell>
      <h1>Billing</h1>
      <p>
        Payments and subscriptions are not activated. Provider reservations are
        separate from customer credit.
      </p>
      <CustomerAccount />
    </Shell>
  );
}
