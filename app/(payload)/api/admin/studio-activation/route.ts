import { NextRequest } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { stagingDenial } from "@/lib/staging";
import { adminTestOwner } from "@/cms/first-test";
import { dataDir, limit } from "@/lib/db";
import {
  activationEvidence,
  prepareActivationPolicy,
  recoveryHealth,
} from "@/lib/live/studio-activation";
import { StudioLiveError } from "@/lib/live/studio-policy";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (v: unknown, status = 200) =>
  Response.json(v, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
async function handler(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  if (process.env.CMS_ENABLED !== "true")
    return json({ error: "CMS disabled." }, 503);
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: req.headers });
  let owner: string;
  try {
    owner = adminTestOwner(user, req.method, req.headers, process.env);
  } catch {
    return json({ error: "Super Admin and exact Origin required." }, 403);
  }
  try {
    limit(`studio-activation:${owner}`, 10, 60000);
    if (req.method === "GET") {
      const health = await recoveryHealth(dataDir);
      let evidence = null,
        blocker = null;
      try {
        evidence = await activationEvidence(dataDir, owner);
      } catch (e) {
        blocker =
          e instanceof StudioLiveError
            ? e.message
            : "Local output metadata unavailable.";
      }
      return json({
        staffId: String(user!.id),
        allowlisted: (process.env.BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS || "")
          .split(",")
          .map((s) => s.trim())
          .includes(String(user!.id)),
        recoveryEnabled:
          process.env.BYTEPLUS_STUDIO_RECOVERY_ENABLED === "true",
        health,
        evidence,
        blocker,
      });
    }
    const reader = req.body?.getReader();
    if (!reader) return json({ error: "Body required." }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > 16384)
          throw new StudioLiveError("BODY_LIMIT", "Review too large.", 413);
        chunks.push(p.value);
      }
    } finally {
      await reader.cancel();
    }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    await payload.create({
      collection: "audit-events",
      overrideAccess: true,
      data: {
        actor: String(user!.id),
        action: "studio:prepare-policy-offline",
        resource: "private-studio-policy",
        record: "2062100414",
      },
    });
    return json(await prepareActivationPolicy(dataDir, owner, input));
  } catch (e) {
    if (e instanceof StudioLiveError)
      return json({ error: e.message, code: e.code }, e.status);
    console.warn("studio activation blocked", {
      code: "ACTIVATION_STORAGE_OR_REVIEW",
    });
    return json(
      {
        error:
          "Private policy preparation failed. Check the review and persistent volume; existing files were preserved.",
        code: "ACTIVATION_STORAGE_OR_REVIEW",
      },
      400,
    );
  }
}
export { handler as GET, handler as POST };
