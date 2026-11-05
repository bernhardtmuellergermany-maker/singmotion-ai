import { hasRole } from "./policy.ts";
import { cmsOriginFailure } from "./request-security.ts";
import { StudioLiveError } from "../lib/live/studio-policy.ts";

/**
 * Independent paid-Studio operator authorization. An explicitly allowlisted
 * editor may operate the Studio without receiving CMS Super Admin privileges.
 * The shared staging password and anonymous media session never grant access.
 */
export function studioStaff(
  user: unknown,
  method: string,
  headers: Headers,
  env: Record<string, string | undefined>,
) {
  if (
    env.CMS_ENABLED !== "true" ||
    !hasRole(user, ["super-admin", "editor"]) ||
    cmsOriginFailure(method, headers, env.CMS_ORIGIN)
  )
    throw new StudioLiveError(
      "STAFF_AUTH_REQUIRED",
      "Authenticated and allowlisted Studio operator with exact Origin required.",
      403,
    );
  const id = (user as { id?: unknown }).id;
  if (
    (typeof id !== "number" && typeof id !== "string") ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(String(id))
  )
    throw new StudioLiveError("STAFF_AUTH_REQUIRED", "Invalid operator identity.", 403);
  // A CMS Super Admin role alone never authorizes a billable Studio task.
  // Both super admins and editors require explicit exact operator ID allowlisting.
  // Private Production Super Admin testing is independent of Stripe and
  // customer launch. It requires a dedicated switch, Basic Auth and the
  // authenticated CMS super-admin role; editors always need an allowlist.
  const privateSuperAdmin =
    env.RAILWAY_ENVIRONMENT_ID === "36adc41d-7e54-4396-ad1a-fd432ba0441d" &&
    env.SUPER_ADMIN_PRIVATE_GENERATION_ENABLED === "true" &&
    env.STAGING_AUTH_ENABLED === "true" &&
    env.PRODUCTION_PUBLIC_ACCESS_ENABLED === "false" &&
    hasRole(user, ["super-admin"]);
  if (
    !privateSuperAdmin &&
    !(env.BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .includes(String(id))
  )
    throw new StudioLiveError(
      "PILOT_NOT_ALLOWED",
      "This operator is not allowlisted for paid Studio generation.",
      403,
    );
  return `cms-staff-${id}`;
}
