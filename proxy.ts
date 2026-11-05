import { NextRequest, NextResponse } from "next/server";
import { stagingAccess, stagingDenial, stagingEnabled, PRIVATE_GATE_COOKIE, PRIVATE_GATE_TTL_SECONDS, issuePrivateGateTicket, validPrivateGateTicket } from "./lib/staging";

// No matcher exclusions: APIs, public media, Next assets and RSC requests are private.
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Stripe cannot provide browser Basic Auth. Only these exact POST endpoints
  // bypass the outer gate; both handlers verify signed Stripe payloads.
  const signedStripeWebhook = request.method === "POST" &&
    (pathname === "/api/stripe-webhook" || pathname === "/api/hobby-webhook");
  const originalAuthorization = request.headers.get("authorization");
  let cookieAuthorized = false;
  const headers = new Headers(request.headers);
  if (!signedStripeWebhook) {
    // Mobile browsers and embedded WebViews can drop cached HTTP Basic
    // credentials on fetch/RSC navigations. An HttpOnly signed session keeps
    // the outer privacy gate intact without making customers enter the
    // shared password on every background API request.
    const ticket = request.cookies.get(PRIVATE_GATE_COOKIE)?.value;
    if (!originalAuthorization && validPrivateGateTicket(ticket)) {
      cookieAuthorized = true;
      headers.set("authorization", "SingMotionSession " + ticket);
      // A private-gate cookie must not authorize cross-origin mutations.
      // Normal CMS/Studio authorization and Origin checks remain separate.
      if (!["GET","HEAD","OPTIONS"].includes(request.method) &&
          request.headers.get("origin") !== request.nextUrl.origin)
        return new NextResponse("Private session requires same-origin request.", {status:403});
    }
    const denied = stagingDenial(headers.get("authorization"));
    if (denied) return denied;
  }
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
  const response = NextResponse.next({
    request: {headers},
  });
  // Only an already validated Basic password may mint a private cookie.
  // A signed ticket can authenticate but cannot extend its own lifetime.
  if (!signedStripeWebhook && stagingEnabled() && !cookieAuthorized &&
      originalAuthorization?.startsWith("Basic ") &&
      stagingAccess(originalAuthorization) === 200) {
    response.cookies.set(PRIVATE_GATE_COOKIE, issuePrivateGateTicket(), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/",
      maxAge: PRIVATE_GATE_TTL_SECONDS,
    });
  }
  if (stagingEnabled()) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}
