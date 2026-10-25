import { NextRequest } from "next/server";
import { getPayload } from "payload";
import payloadConfig from "@payload-config";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { stagingDenial } from "@/lib/staging";
import { studioStaff } from "@/cms/studio-access";
import { session, limit, dataDir } from "@/lib/db";
import { openStudioStore } from "@/lib/live/studio";
import { studioRuntime, studioReadiness } from "@/lib/live/studio-runtime";
import {
  StudioLiveError,
  studioDiagnostic,
  loadStudioPolicy,
  studioConfig,
  studioGate,
} from "@/lib/live/studio-policy";
import { AppError } from "@/lib/domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
async function handler(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  let runtime: ReturnType<typeof studioRuntime> | undefined;
  try {
    if (process.env.CMS_ENABLED !== "true") {
      if (req.method !== "GET" || req.nextUrl.searchParams.has("id"))
        return json({ error: "CMS disabled." }, 503);
      return json({
        available: false,
        projects: [],
        blockers: ["Studio paid pilot is disabled."],
      });
    }
    const payload = await getPayload({ config: payloadConfig });
    const { user } = await payload.auth({ headers: req.headers });
    try {
      studioStaff(user, req.method, req.headers, process.env);
    } catch (e) {
      if (
        req.method === "GET" &&
        !req.nextUrl.searchParams.has("id") &&
        e instanceof StudioLiveError &&
        e.code === "STAFF_AUTH_REQUIRED"
      )
        return json({
          available: false,
          projects: [],
          blockers: ["Paid Studio pilot requires a Super Admin login."],
        });
      throw e;
    }
    const auth = session(req.cookies.get("sm_session")?.value);
    if (!auth)
      throw new StudioLiveError(
        "SESSION_REQUIRED",
        "Open Studio to establish your private media session.",
        401,
      );
    const owner = auth.owner;
    limit(`${owner}:studio-live`, req.method === "POST" ? 10 : 60, 60000);
    runtime = studioRuntime(await openStudioStore(dataDir), dataDir);
    const service = runtime.service;
    if (req.method === "GET") {
      const id = req.nextUrl.searchParams.get("id");
      if (id && req.nextUrl.searchParams.has("video")) {
        const file = await service.output(id, owner),
          size = (await stat(file)).size;
        let start = 0,
          end = size - 1,
          status = 200;
        const range = req.headers.get("range");
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(range);
          start = Number(match?.[1]);
          end = match?.[2] ? Number(match[2]) : size - 1;
          if (
            !match ||
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            end >= size
          )
            return new Response(null, {
              status: 416,
              headers: { ...headers, "Content-Range": `bytes */${size}` },
            });
          status = 206;
        }
        return new Response(
          Readable.toWeb(
            createReadStream(file, { start, end }),
          ) as ReadableStream,
          {
            status,
            headers: {
              ...headers,
              "Content-Type": "video/mp4",
              "Accept-Ranges": "bytes",
              "Content-Length": String(end - start + 1),
              ...(status === 206
                ? { "Content-Range": `bytes ${start}-${end}/${size}` }
                : {}),
              "Content-Disposition": `${req.nextUrl.searchParams.has("download") ? "attachment" : "inline"}; filename="singmotion.mp4"`,
            },
          },
        );
      }
      if (id) return json(service.view(id, owner));
      const blockers: string[] = [];
      try {
        studioGate(studioConfig());
        await loadStudioPolicy(dataDir);
        await studioReadiness(dataDir);
      } catch (e) {
        blockers.push(
          e instanceof StudioLiveError
            ? e.message
            : "Server policy unavailable.",
        );
      }
      return json({
        pilot: true,
        available: blockers.length === 0,
        projects: service.list(owner),
        blockers,
      });
    }
    const reader = req.body?.getReader();
    if (!reader)
      throw new StudioLiveError("BODY_REQUIRED", "Request required.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        bytes += p.value.length;
        if (bytes > 32768)
          throw new StudioLiveError(
            "REQUEST_TOO_LARGE",
            "Request too large.",
            413,
          );
        chunks.push(p.value);
      }
    } finally {
      await reader.cancel();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.action === "prepare")
      return json(
        await service.prepare(
          body.selection,
          owner,
          body.artistName,
          body.consent,
          body.english,
        ),
      );
    if (typeof body.id !== "string")
      throw new StudioLiveError(
        "PROJECT_REQUIRED",
        "Choose a saved Studio project.",
      );
    if (body.action === "submit") {
      service.view(body.id, owner);
      await payload.create({
        collection: "audit-events",
        overrideAccess: true,
        data: {
          actor: String(user!.id),
          action: "studio:explicit-paid-confirmation",
          resource: "private-studio-project",
          record: body.id,
        },
      });
      return json(
        await service.submit(
          body.id,
          owner,
          body.digest,
          body.ceilingMicroUsd,
          body.confirmation,
        ),
      );
    }
    if (body.action === "poll") return json(await service.poll(body.id, owner));
    throw new StudioLiveError("ACTION_INVALID", "Unsupported Studio action.");
  } catch (e) {
    if (e instanceof StudioLiveError || e instanceof AppError)
      return json(
        {
          error: e.message,
          ...(e instanceof StudioLiveError ? { code: e.code } : {}),
        },
        e.status,
      );
    const safe = studioDiagnostic(e);
    console.warn("studio-live operation rejected", { code: safe.code });
    return json({ error: safe.message, code: safe.code }, safe.status);
  } finally {
    runtime?.close();
  }
}
export { handler as GET, handler as POST };
