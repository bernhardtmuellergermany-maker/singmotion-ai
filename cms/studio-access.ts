import { adminTestOwner } from "./first-test.ts";
import { StudioLiveError } from "../lib/live/studio-policy.ts";
/** The current pilot cannot be enabled for customer/anonymous sessions by an env flag. */
export function studioStaff(
  user: unknown,
  method: string,
  headers: Headers,
  env: Record<string, string | undefined>,
) {
  let identity: string;
  try {
    identity = adminTestOwner(user, method, headers, env);
  } catch {
    throw new StudioLiveError(
      "STAFF_AUTH_REQUIRED",
      "Super Admin authentication and exact Origin required.",
      403,
    );
  }
  if (
    !(env.BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .includes(identity.replace("cms-staff-", ""))
  )
    throw new StudioLiveError(
      "PILOT_NOT_ALLOWED",
      "This administrator is not on the Studio pilot allowlist.",
      403,
    );
  return identity;
}
