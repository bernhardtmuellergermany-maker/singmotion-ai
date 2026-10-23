import { NextRequest, NextResponse } from "next/server";
import { stagingDenial, stagingEnabled } from "./lib/staging";

// No matcher exclusions: APIs, public media, Next assets and RSC requests are private.
export function proxy(request: NextRequest) {
  const denied = stagingDenial(request.headers.get("authorization"));
  if (denied) return denied;
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/cms" ||
    pathname.startsWith("/api/cms/") ||
    pathname.startsWith("/cms-preview/")
  ) {
    if (process.env.CMS_ENABLED !== "true")
      return new NextResponse("CMS disabled.", { status: 503 });
    if (
      /\/(first-register|create-first-user)(\/|$)/i.test(
        decodeURIComponent(pathname),
      )
    )
      return new NextResponse("Public provisioning disabled.", { status: 403 });
  }
  const response = NextResponse.next();
  if (stagingEnabled()) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}
