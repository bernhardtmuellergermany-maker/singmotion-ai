import { stagingDenial } from "@/lib/staging";
import { termsVersion } from "@/lib/rights";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  return Response.json(
    { version: termsVersion() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
