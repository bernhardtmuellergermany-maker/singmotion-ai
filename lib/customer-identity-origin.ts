import { applicationOrigin } from "./request-origin.ts";
import {assessProductionSandboxPilot} from "./commerce/customer-sandbox-pilot-policy.ts";
import { productionCustomerReleaseApproved, productionPrivateCustomerPreviewEnabled, PRODUCTION_RAILWAY_ENVIRONMENT_ID } from "./commerce/customer-live-config.ts";

type Env = Record<string, string | undefined>;
const STAGING = "dfaeabed-03df-43ed-aa71-50f343a75041";
const STAGING_ORIGIN = "https://singmotion-ai-staging.up.railway.app";
const PRODUCTION_ORIGIN = "https://www.singmotion.ai";

/** Both the canonical OAuth callback and account reset must be exact HTTPS origins.
 * Do not derive redirect URIs from forwarded headers, user-controlled query values,
 * or a Host header. No secrets or live payment approval are inferred here.
 */
export function customerIdentityOrigin(env: Env): string | null {
  const id = env.RAILWAY_ENVIRONMENT_ID;
  if (env.CUSTOMER_ACCOUNTS_ENABLED !== "true") return null;
  const candidate = id === STAGING ? STAGING_ORIGIN :
    id === PRODUCTION_RAILWAY_ENVIRONMENT_ID &&
    (productionPrivateCustomerPreviewEnabled(env) || productionCustomerReleaseApproved(env) || assessProductionSandboxPilot(env).ready) ?
      PRODUCTION_ORIGIN : null;
  if (!candidate || env.APP_ORIGIN !== candidate) return null;
  return applicationOrigin(candidate + "/api/customer-auth", new URL(candidate).host, env) === candidate ? candidate : null;
}
export function googleLoginReady(env: Env): boolean {
  return customerIdentityOrigin(env) !== null &&
    Boolean(env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
}
export function passwordResetReady(env: Env): boolean {
  return customerIdentityOrigin(env) !== null &&
    Boolean(env.RESEND_API_KEY?.trim() && env.ACCOUNT_EMAIL_FROM?.trim());
}
export function trustedIdentityHost(host: string | null, canonical: string): boolean {
  return host === new URL(canonical).host;
}
