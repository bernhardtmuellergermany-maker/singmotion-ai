export const dynamic = "force-dynamic";
import { Shell } from "@/components/shell";
import { Billing } from "@/components/settings";
import { quote } from "@/lib/domain";
export default function Page() {
  return (
    <Shell>
      <Billing referencePrice={quote(10).cents} />
    </Shell>
  );
}
