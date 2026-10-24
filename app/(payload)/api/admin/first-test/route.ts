import { PreparationError, preparationError } from "@/cms/preparation-error";
import { getPayload } from "payload";
import config from "@payload-config";
import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { chmod, mkdir, realpath, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import sharp from "sharp";
import { stagingDenial } from "@/lib/staging";
import { dataDir, limit } from "@/lib/db";
import { LiveTestStore } from "@/lib/live/store";
import { ReviewValidationError } from "@/lib/live/review-diagnostics";
import {
  AdminFirstTest,
  AdminTestError,
  adminTestOwner,
} from "@/cms/first-test";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
async function bounded(request: Request, maximum: number) {
  if (Number(request.headers.get("content-length")) > maximum)
    throw new AdminTestError("Upload/request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AdminTestError("Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maximum)
        throw new AdminTestError("Upload/request is too large.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
async function handle(request: NextRequest) {
  const denied = stagingDenial(request.headers.get("authorization"));
  if (denied) return denied;
  if (process.env.CMS_ENABLED !== "true")
    return json({ error: "CMS disabled." }, 503);
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: request.headers });
  let owner: string;
  try {
    owner = adminTestOwner(user, request.method, request.headers, process.env);
  } catch {
    return json(
      { error: "Super Admin authentication and exact Origin required." },
      403,
    );
  }
  let store: LiveTestStore | undefined;
  try {
    limit(`cms:first-test:${owner}`, 60, 60000);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const root = await realpath(dataDir),
      ledger = path.join(root, "live-test.sqlite");
    store = new LiveTestStore(ledger);
    await chmod(ledger, 0o600);
    const service = new AdminFirstTest(store, root, owner, process.env);
    if (request.method === "GET") {
      const id = request.nextUrl.searchParams.get("plan") || undefined;
      const media = request.nextUrl.searchParams.get("media");
      if (!media) return json(await service.status(id));
      if (!id || !["image", "audio", "video"].includes(media))
        return json({ error: "Not found." }, 404);
      const attempt = service.owned(id);
      const name =
        media === "image"
          ? attempt.media.imagePath
          : media === "audio"
            ? attempt.media.audioPath
            : attempt.state === "completed"
              ? attempt.outputPath
              : null;
      if (!name) return json({ error: "Validated result not available." }, 404);
      const file = await realpath(name),
        base = await realpath(
          path.join(root, media === "video" ? "live-output" : "media"),
        );
      if (!file.startsWith(base + path.sep))
        throw new Error("Private path rejected");
      const info = await stat(file);
      if (!info.isFile()) throw new Error("Not a file");
      let start = 0,
        end = info.size - 1,
        status = 200;
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match)
          return new Response(null, {
            status: 416,
            headers: { ...headers, "Content-Range": `bytes */${info.size}` },
          });
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          end >= info.size
        )
          return new Response(null, {
            status: 416,
            headers: { ...headers, "Content-Range": `bytes */${info.size}` },
          });
        status = 206;
      }
      const type =
        media === "video"
          ? "video/mp4"
          : media === "audio"
            ? "audio/mpeg"
            : (await sharp(file).metadata()).format === "jpeg"
              ? "image/jpeg"
              : "image/png";
      return new Response(
        Readable.toWeb(
          createReadStream(file, { start, end, signal: request.signal }),
        ) as ReadableStream<Uint8Array>,
        {
          status,
          headers: {
            ...headers,
            "Content-Type": type,
            "Content-Length": String(end - start + 1),
            "Accept-Ranges": "bytes",
            ...(status === 206
              ? { "Content-Range": `bytes ${start}-${end}/${info.size}` }
              : {}),
            ...(request.nextUrl.searchParams.get("download") === "1"
              ? {
                  "Content-Disposition":
                    'attachment; filename="singmotion-first-test.mp4"',
                }
              : {}),
          },
        },
      );
    }
    const multipart = request.headers
      .get("content-type")
      ?.startsWith("multipart/form-data;");
    if (multipart) {
      // adminTestOwner above admits authenticated Super Admins only.
      // Keep request/body limits; ordinary customer upload limits are unchanged.
      const form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: await bounded(request, 20_100_000),
      })
        .formData()
        .catch((error) => {
          throw preparationError(error, "multipart");
        });
      const image = form.get("image"),
        audio = form.get("audio");
      if (!(image instanceof File) || !(audio instanceof File))
        throw new AdminTestError("Select one singer image and one MP3.");
      await payload.create({
        collection: "audit-events",
        overrideAccess: true,
        data: {
          actor: String(user!.id),
          action: "first-test:prepare",
          resource: "private-operator-test",
          record: "new",
        },
      });
      return json(
        await service.upload(
          image,
          audio,
          String(form.get("prompt") || ""),
          form.get("rights") === "true",
          form.get("english") === "true",
        ),
      );
    }
    const body = JSON.parse((await bounded(request, 65536)).toString("utf8"));
    const {
      action,
      plan,
      review,
      confirmation = "",
      outputConfirmation = "",
      phrase = "",
    } = body;
    if (
      typeof plan !== "string" ||
      ![
        "cost-review",
        "output-review",
        "start",
        "poll",
        "download",
        "refresh",
        "cancel",
        "cleanup",
      ].includes(action)
    )
      throw new AdminTestError("Invalid action.");
    service.owned(plan);
    await payload.create({
      collection: "audit-events",
      overrideAccess: true,
      data: {
        actor: String(user!.id),
        action: `first-test:${action}`,
        resource: "private-operator-test",
        record: plan,
      },
    });
    if (action === "cost-review" || action === "output-review")
      return json(
        await service.saveReview(
          plan,
          action === "cost-review" ? "cost" : "output",
          review && typeof review === "object" && !Array.isArray(review)
            ? {
                ...review,
                reviewedBy: owner,
                reviewedAt: new Date().toISOString(),
              }
            : review,
        ),
      );
    if (action === "start") limit(`cms:first-test:start:${owner}`, 3, 3600000);
    return json(
      await service.execute(
        action,
        plan,
        confirmation,
        outputConfirmation,
        phrase,
        body.discovery === true,
      ),
    );
  } catch (error) {
    // Only static category codes are logged, never raw errors or private inputs.
    const preparing =
      request.method === "POST" &&
      request.headers.get("content-type")?.startsWith("multipart/form-data;");
    if (
      error instanceof PreparationError ||
      (preparing &&
        !(error instanceof AdminTestError) &&
        !(error instanceof ReviewValidationError))
    ) {
      const safe = preparationError(error, "plan");
      console.warn("first-test:prepare rejected", safe.code);
      return json(
        { error: safe.message, code: safe.code },
        safe.code === "prepare-rate-limit" ? 429 : 400,
      );
    }
    // Never serialize provider errors, paths, credentials, presigned URLs or raw bodies.
    if (error instanceof ReviewValidationError)
      return json(
        { error: "Review incomplete or invalid.", issues: error.issues },
        400,
      );
    if (error instanceof AdminTestError)
      return json({ error: error.message }, 400);
    return json(
      {
        error:
          "Operation stopped safely. Check media/reviews and server gates. Refresh saved status; never repeat an uncertain submission.",
      },
      400,
    );
  } finally {
    store?.close();
  }
}
export const GET = handle;
export const POST = handle;
