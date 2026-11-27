import { applicationOrigin } from "./request-origin.ts";
import {assessProductionSandboxPilot} from "./commerce/customer-sandbox-pilot-policy.ts";
import { productionCustomerReleaseApproved, productionPrivateCustomerPreviewEnabled, PRODUCTION_RAILWAY_ENVIRONMENT_ID, customerAccountSettingsAccessible, existingCustomerAccountAccessEnabled } from "./commerce/customer-live-config.ts";
import {publicCreditReleaseApproved} from "./commerce/public-credit-release.ts";
import {privateInternationalCreditBetaEnabled} from "./commerce/private-international-credit-beta.ts";

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
  // Automated browser tests run against a temporary 127.0.0.1-only server
  // with no Stripe checkout or provider. This cannot be enabled by any
  // deployed Railway instance, where RAILWAY_ENVIRONMENT_ID is always set.
  if (env.SINGMOTION_ISOLATED_ERASURE_TEST === "true" &&
      customerAccountSettingsAccessible(env) &&
      env.GOOGLE_OAUTH_CLIENT_ID === undefined &&
      env.GOOGLE_OAUTH_CLIENT_SECRET === undefined)
    return env.APP_ORIGIN || null;
  const candidate = id === STAGING ? STAGING_ORIGIN :
    id === PRODUCTION_RAILWAY_ENVIRONMENT_ID &&
    (customerIdentityRegistrationAllowed(env) || existingCustomerAccountAccessEnabled(env)) ?
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

/** The existing Google sign-in path may create a new account only under its
 * original registration gate. Existing identities never depend on checkout. */
export function customerIdentityRegistrationAllowed(env: Env): boolean {
 return env.CUSTOMER_ACCOUNTS_ENABLED==="true" && (env.RAILWAY_ENVIRONMENT_ID===STAGING ||
  (env.RAILWAY_ENVIRONMENT_ID===PRODUCTION_RAILWAY_ENVIRONMENT_ID &&
   (productionPrivateCustomerPreviewEnabled(env)||productionCustomerReleaseApproved(env)||publicCreditReleaseApproved(env)||assessProductionSandboxPilot(env).ready||privateInternationalCreditBetaEnabled(env))));
}
