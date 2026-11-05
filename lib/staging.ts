import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {productionCustomerReleaseApproved,PRODUCTION_RAILWAY_ENVIRONMENT_ID} from "./commerce/customer-live-config.ts";

type Environment = Record<string, string | undefined>;
/**
 * A short-lived, server-signed private-gate ticket for mobile browsers.
 * It is distinct from CMS/staff authentication and never grants a role.
 * Changing STAGING_PASSWORD invalidates every issued ticket.
 */
/** Only trusted, server-configured public origins authorize mobile-cookie mutations.
 * Railway reverse proxies can expose an internal http origin in request.nextUrl.
 * Neither Host nor X-Forwarded-* are valid CSRF authority.
 */
export function privateGateMutationOriginAllowed(
  origin: string | null,
  pathname: string,
  internalRequestOrigin: string,
  env: Environment = process.env,
): boolean {
  if (!origin || origin === "null") return false;
  const cmsRoute = pathname === "/api/cms" || pathname.startsWith("/api/cms/");
  const expected = cmsRoute ? env.CMS_ORIGIN : (env.APP_ORIGIN || env.PUBLIC_SITE_ORIGIN);
  return origin === (expected || internalRequestOrigin);
}

export const PRIVATE_GATE_COOKIE = "sm_private_gate";
export const PRIVATE_GATE_TTL_SECONDS = 12 * 60 * 60;
const PRIVATE_GATE_VERSION = "v1";
export function issuePrivateGateTicket(
  env: Environment = process.env,
  now = Date.now(),
): string {
  validateStaging(env);
  if (!stagingEnabled(env)) throw new Error("Private gate disabled");
  const issued = Math.floor(now / 1000);
  const payload = `${PRIVATE_GATE_VERSION}.${issued}`;
  const signature = createHmac("sha256", env.STAGING_PASSWORD!)
    .update("SingMotion private gate\n" + (env.RAILWAY_ENVIRONMENT_ID || "none") + "\n" + payload)
    .digest("hex");
  return payload + "." + signature;
}
export function validPrivateGateTicket(
  token: string | undefined | null,
  env: Environment = process.env,
  now = Date.now(),
): boolean {
  if (!token || token.length > 160 || !stagingEnabled(env)) return false;
  try { validateStaging(env); } catch { return false; }
  const match = /^(v1)\.([1-9][0-9]{8,12})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const issued = Number(match[2]);
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issued) || issued > current + 60 ||
      current - issued > PRIVATE_GATE_TTL_SECONDS) return false;
  const expected = issuePrivateGateTicket(env, issued * 1000);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function stagingEnabled(env: Environment = process.env) {
  // Public production is an independent, explicit decision. Never turn the
  // private staging service public, and never mistake an arbitrary Railway
  // environment for an approved Live service.
  if(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION_RAILWAY_ENVIRONMENT_ID)
   return !(env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="true" &&
     env.STAGING_AUTH_ENABLED!=="true" &&
     productionCustomerReleaseApproved(env));
  return (
    Boolean(env.RAILWAY_ENVIRONMENT_ID) ||
    env.STAGING_AUTH_ENABLED === "true" ||
    (env.NODE_ENV === "production" && env.STAGING_AUTH_ENABLED !== "false")
  );
}
export function validateStaging(env: Environment = process.env) {
  if (!stagingEnabled(env)) return;
  if (!env.STAGING_PASSWORD || env.STAGING_PASSWORD.length < 32)
    throw new Error(
      "Set STAGING_PASSWORD to a random secret of at least 32 characters.",
    );
  if (
    env.DEMO_MODE !== "true" ||
    env.GENERATIONS_ENABLED !== "false" ||
    env.ADMIN_DEMO_ENABLED !== "false" ||
    env.BYTEPLUS_LIVE_TEST_ENABLED === "true"
  )
    throw new Error(
      "Staging requires DEMO_MODE=true, GENERATIONS_ENABLED=false, ADMIN_DEMO_ENABLED=false and BYTEPLUS_LIVE_TEST_ENABLED=false.",
    );
}
export function stagingAccess(
  authorization: string | null,
  env: Environment = process.env,
): 200 | 401 | 503 {
  if (!stagingEnabled(env)) return 200;
  try {
    validateStaging(env);
  } catch {
    return 503;
  }
  if (authorization?.startsWith("SingMotionSession "))
    return validPrivateGateTicket(authorization.slice("SingMotionSession ".length), env) ? 200 : 401;
  if (
    !authorization ||
    authorization.length > 4096 ||
    !/^Basic [A-Za-z0-9+/]+=*$/i.test(authorization)
  )
    return 401;
  const received = Buffer.from(authorization.slice(6), "base64").toString(
    "utf8",
  );
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(
    digest(received),
    digest(`staging:${env.STAGING_PASSWORD}`),
  )
    ? 200
    : 401;
}
export function stagingDenial(
  authorization: string | null,
): Response | undefined {
  const status = stagingAccess(authorization);
  if (status === 200) return;
  return new Response(
    status === 401
      ? "Staging authentication required."
      : "Staging configuration unavailable.",
    {
      status,
      headers: {
        "WWW-Authenticate": 'Basic realm="SingMotion staging", charset="UTF-8"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

/** Only Stripe-signed server POST endpoints bypass browser Basic Auth. */
export function isSignedStripeWebhookRoute(method:string,pathname:string):boolean {
  return method==="POST" && (pathname==="/api/stripe-webhook" || pathname==="/api/hobby-webhook");
}
