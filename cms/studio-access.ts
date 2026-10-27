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
  if (
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
