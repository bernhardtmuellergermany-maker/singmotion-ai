import { NextRequest, NextResponse } from "next/server";
import { stagingDenial, stagingEnabled } from "./lib/staging";

// No matcher exclusions: APIs, public media, Next assets and RSC requests are private.
export function proxy(request: NextRequest) {
  const denied = stagingDenial(request.headers.get("authorization"));
  if (denied) return denied;
  const response = NextResponse.next();
  if (stagingEnabled()) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}
