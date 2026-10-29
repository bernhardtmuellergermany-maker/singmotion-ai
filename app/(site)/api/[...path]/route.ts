import { parseSavedStudioDraft } from "@/lib/studio-draft";
import { requireRights, recordRights, termsVersion } from "@/lib/rights";
import { applicationOrigin } from "@/lib/request-origin";
import { stagingDenial, stagingEnabled } from "@/lib/staging";
import { removeOfflinePlans } from "@/lib/live/cleanup";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  db,
  dataDir,
  demoOnly,
  session,
  createSession,
  revokeMediaSession,
  grantAdmin,
  balance,
  list,
  asset,
  putAsset,
  artist,
  saveArtist,
  job,
  saveJob,
  enqueue,
  transition,
  limit,
} from "@/lib/db";
import {
  AppError,
  validateFile,
  validateSelection,
  quote,
  composePrompt,
  views,
  type Asset,
  type Artist,
  type Job,
} from "@/lib/domain";
import { validateAudio } from "@/lib/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function requireOrigin(req: NextRequest) {
  const expected = applicationOrigin(req.url, req.headers.get("host"));
  if (!expected)
    throw new AppError(
      "Application origin is not configured. Contact the administrator.",
      503,
    );
  if (req.headers.get("origin") !== expected)
    throw new AppError("Request origin is not allowed.", 403);
}
async function boundedBody(req: NextRequest, max: number) {
  if (Number(req.headers.get("content-length")) > max)
    throw new AppError("Request is too large.", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new AppError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError("Request is too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function body(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const result = JSON.parse((await boundedBody(req, 32768)).toString());
    if (!result || Array.isArray(result) || typeof result !== "object")
      throw new Error();
    return result;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Invalid JSON request.");
  }
}
function string(v: unknown, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new AppError("A required text field is missing or too long.");
  return v.trim();
}
const safeAsset = (a: Asset) => {
  const { path: _path, owner: _owner, ...v } = a;
  void _path;
  void _owner;
  return v;
};
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  try {
    demoOnly();
    const parts = (await params).path;
    const route = parts[0],
      id = parts[1];
    const method = req.method;
    if (method !== "GET") requireOrigin(req);
    const token = req.cookies.get("sm_session")?.value;
    let auth = session(token);
    // Disconnect this browser's private demo workspace without deleting its data.
    if (route === "session" && id === "logout" && method === "POST") {
      if (token) revokeMediaSession(token);
      const response = json({ signedOut: true });
      response.cookies.delete("sm_session");
      return response;
    }
    if (route === "session" && method === "POST") {
      if (auth)
        return json({
          owner: auth.owner,
          balance: balance(auth.owner),
          demo: true,
        });
      limit("session:global", 120);
      const created = createSession();
      auth = { owner: created.owner, admin: 0 };
      const response = json({
        owner: auth.owner,
        balance: balance(auth.owner),
        demo: true,
      });
      response.cookies.set("sm_session", created.token, {
        httpOnly: true,
        secure: stagingEnabled() || req.nextUrl.protocol === "https:",
        sameSite: "strict",
        path: "/",
        maxAge: 30 * 86400,
      });
      return response;
    }
    if (!auth)
      throw new AppError(
        "Open the studio to start a private demo session.",
        401,
      );
    const owner = auth.owner;
    if (route === "studio-drafts") {
      db.exec(
        "CREATE TABLE IF NOT EXISTS studio_drafts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, selection TEXT NOT NULL, artist_name TEXT NOT NULL, step INTEGER NOT NULL, updated INTEGER NOT NULL)",
      );
      const view = (row: Record<string, unknown>) => {
        const selected = parseSavedStudioDraft(
          JSON.parse(String(row.selection)),
        );
        return {
          id: row.id,
          selection: selected,
          artistName: row.artist_name,
          step: row.step,
          updated: row.updated,
          song: selected.songId
            ? safeAsset(asset(selected.songId, owner))
            : null,
          image: selected.imageId
            ? safeAsset(asset(selected.imageId, owner))
            : null,
        };
      };
      if (method === "GET") {
        if (!id)
          return json(
            db
              .prepare(
                "SELECT * FROM studio_drafts WHERE owner=? ORDER BY updated DESC LIMIT 100",
              )
              .all(owner)
              .map(view),
          );
        const row = db
          .prepare("SELECT * FROM studio_drafts WHERE id=? AND owner=?")
          .get(id, owner);
        if (!row) throw new AppError("Draft unavailable.", 404);
        return json(view(row));
      }
      if (method === "DELETE" && id) {
        const result = db.prepare("DELETE FROM studio_drafts WHERE id=? AND owner=?").run(id,owner);
        if (!result.changes) throw new AppError("Draft unavailable.",404);
        return json({deleted:true});
      }
      if (method === "POST") {
        limit(`${owner}:drafts`, 60, 60000);
        const input = await body(req),
          selected = parseSavedStudioDraft(input.selection);
        if (selected.owner !== owner)
          throw new AppError("Draft unavailable.", 403);
        if (
          (selected.songId && asset(selected.songId, owner).kind !== "audio") ||
          (selected.imageId && asset(selected.imageId, owner).kind !== "image")
        )
          throw new AppError("Invalid draft media.");
        const key = string(input.id, 80);
        if (!/^[a-zA-Z0-9-]+$/.test(key))
          throw new AppError("Invalid draft identifier.");
        const step = Number(input.step);
        if (!Number.isInteger(step) || step < 0 || step > 4)
          throw new AppError("Invalid draft step.");
        const result = db
          .prepare(
            "INSERT INTO studio_drafts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET selection=excluded.selection,artist_name=excluded.artist_name,step=excluded.step,updated=excluded.updated WHERE studio_drafts.owner=excluded.owner",
          )
          .run(
            key,
            owner,
            JSON.stringify(selected),
            string(input.artistName, 80),
            step,
            Date.now(),
          );
        if (result.changes !== 1) throw new AppError("Draft unavailable.", 403);
        return json({ id: key });
      }
      throw new AppError("Method not allowed.", 405);
    }

    if (method !== "GET") limit(`${owner}:write`, 60);
    if (route === "session" && method === "GET")
      return json({ owner, balance: balance(owner), demo: true });
    if (route === "assets" && method === "POST") {
      limit(`${owner}:upload`, 15);
      const form = await new Response(
        await boundedBody(req, 51 * 1024 * 1024),
        { headers: { "Content-Type": req.headers.get("content-type") || "" } },
      ).formData();
      const file = form.get("file"),
        kind = form.get("kind");
      if (!(file instanceof File) || (kind !== "audio" && kind !== "image"))
        throw new AppError("Choose a file to upload.");
      validateFile(file.name, file.size, kind);
      const total = list<Asset>("assets", owner).reduce(
        (n, a) => n + a.bytes,
        0,
      );
      if (total + file.size > 250 * 1024 * 1024)
        throw new AppError(
          "Demo storage limit reached (250 MB). Delete demo data in Settings.",
          413,
        );
      const bytes = Buffer.from(await file.arrayBuffer());
      const assetId = randomUUID();
      const dest = path.join(dataDir, "media", assetId);
      let duration: number | null = null,
        width: number | null = null,
        height: number | null = null,
        mime = "";
      try {
        await writeFile(dest, bytes, { mode: 0o600, flag: "wx" });
        if (kind === "audio") {
          duration = await validateAudio(dest);
          mime = /\.wav$/i.test(file.name)
            ? "audio/wav"
            : /\.m4a$/i.test(file.name)
              ? "audio/mp4"
              : "audio/mpeg";
        } else {
          const image = sharp(bytes, {
            limitInputPixels: 4096 * 4096,
            failOn: "error",
          });
          const meta = await image.metadata();
          if (
            !["jpeg", "png"].includes(meta.format || "") ||
            !meta.width ||
            !meta.height ||
            meta.width > 4096 ||
            meta.height > 4096 ||
            (meta.pages || 1) > 1
          )
            throw new AppError(
              "Use a still JPEG or PNG, at most 4096 × 4096 pixels.",
            );
          await image.stats();
          const rotated = [5, 6, 7, 8].includes(meta.orientation || 1);
          width = rotated ? meta.height : meta.width;
          height = rotated ? meta.width : meta.height;
          mime = meta.format === "png" ? "image/png" : "image/jpeg";
        }
        const a: Asset = {
          id: assetId,
          owner,
          kind,
          name: file.name.slice(0, 200),
          path: dest,
          mime,
          bytes: file.size,
          duration,
          width,
          height,
          created: Date.now(),
        };
        putAsset(a);
        return json(safeAsset(a), 201);
      } catch (e) {
        await unlink(dest).catch(() => {});
        if (e instanceof AppError) throw e;
        throw new AppError(
          "This file could not be decoded. Upload a valid MP3, WAV, JPEG, or PNG.",
        );
      }
    }
    if (route === "assets" && id && method === "GET") {
      const a = asset(id, owner);
      const content = await readFile(a.path);
      const headers: Record<string, string> = {
        "Content-Type": a.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        "Content-Disposition": `${req.nextUrl.searchParams.has("download") ? "attachment" : "inline"}; filename="${a.kind === "video" ? "singmotion-demo.mp4" : a.kind === "audio" ? "song" + (a.mime === "audio/wav" ? ".wav" : a.mime === "audio/mp4" ? ".m4a" : ".mp3") : "reference" + (a.mime === "image/png" ? ".png" : ".jpg")}"`,
      };
      const range = req.headers.get("range");
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) return new Response(null, { status: 416 });
        const start = Number(match[1]),
          end = match[2] ? Number(match[2]) : content.length - 1;
        if (start > end || end >= content.length)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${content.length}` },
          });
        headers["Content-Range"] = `bytes ${start}-${end}/${content.length}`;
        headers["Content-Length"] = String(end - start + 1);
        return new Response(content.subarray(start, end + 1), {
          status: 206,
          headers,
        });
      }
      headers["Content-Length"] = String(content.length);
      return new Response(content, { headers });
    }
    if (route === "artists" && method === "GET")
      return json(list<Artist>("artists", owner));
    if (route === "artists" && (method === "POST" || method === "PATCH")) {
      const b = await body(req);
      const name = string(b.name, 80);
      if (!Array.isArray(b.images) || !b.images.length || b.images.length > 8)
        throw new AppError("Choose between one and eight reference images.");
      const images = b.images.map((x: unknown) => {
        if (!x || typeof x !== "object") throw new AppError("Invalid image.");
        const { assetId, label } = x as Record<string, unknown>;
        const a = asset(string(assetId), owner);
        if (
          a.kind !== "image" ||
          !views.includes(label as (typeof views)[number])
        )
          throw new AppError("Choose an image and a valid view label.");
        return { assetId: a.id, label: label as string };
      });
      const current = id ? artist(id, owner) : null;
      const a: Artist = {
        id: current?.id || randomUUID(),
        owner,
        name,
        images,
        created: current?.created || Date.now(),
      };
      saveArtist(a);
      return json(a);
    }
    if (route === "artists" && id && method === "DELETE") {
      artist(id, owner);
      db.prepare("DELETE FROM artists WHERE id=? AND owner=?").run(id, owner);
      return json({ deleted: true });
    }
    if (route === "quote" && method === "POST") {
      const b = await body(req);
      return json(quote(Number(b.duration)));
    }
    if (route === "jobs" && method === "GET")
      return json(id ? job(id, owner) : list<Job>("jobs", owner));
    if (route === "jobs" && method === "POST") {
      limit(`${owner}:generation`, 10);
      if (process.env.GENERATIONS_ENABLED === "false")
        throw new AppError("New generations are temporarily disabled.", 503);
      const b = await body(req);
      requireRights(b.consent, b.termsVersion);
      if (b.consent !== true)
        throw new AppError(
          "Confirm that you have permission to use the music and image.",
        );
      const song = asset(string(b.songId), owner),
        image = asset(string(b.imageId), owner);
      if (song.kind !== "audio" || image.kind !== "image")
        throw new AppError("Choose an audio file and one artist image.");
      const start = Number(b.start),
        end = Number(b.end);
      const duration = validateSelection(start, end, song.duration || 0),
        pricing = quote(duration);
      if (pricing.cents !== b.expectedPrice)
        throw new AppError(
          "The price has changed. Review the updated quote.",
          409,
        );
      if (pricing.cents > Number(process.env.MAX_JOB_PRICE_CENTS || 10000))
        throw new AppError(
          "This generation exceeds the configured spending limit.",
        );
      const performance = string(b.performance),
        camera = string(b.camera);
      const prompt = composePrompt(
        performance,
        camera,
        typeof b.customPrompt === "string" ? b.customPrompt : "",
      );
      const key = string(b.requestKey, 100);
      const old = list<Job>("jobs", owner).find((j) => j.requestKey === key);
      if (old) return json(old);
      const heartbeat = await stat(
        path.join(dataDir, "worker-heartbeat"),
      ).catch(() => null);
      if (!heartbeat || Date.now() - heartbeat.mtimeMs > 180000)
        throw new AppError(
          "The demo worker is offline. Start npm run worker, then try again.",
          503,
        );
      const j: Job = {
        id: randomUUID(),
        owner,
        requestKey: key,
        songId: song.id,
        imageId: image.id,
        artistName: string(b.artistName || "My artist", 80),
        start,
        end,
        performance,
        camera,
        prompt,
        price: pricing.cents,
        status: "queued",
        stage: "Waiting for the demo worker",
        outputId: null,
        error: null,
        created: Date.now(),
        updated: Date.now(),
        saved: false,
        demo: true,
      };
      const { db } = await import("@/lib/db");
      recordRights(db, owner, j.id, termsVersion());
      return json(enqueue(j), 201);
    }
    if (route === "jobs" && id && method === "DELETE") {
      const existing = job(id,owner);
      if (["queued","processing"].includes(existing.status))
        throw new AppError("Active jobs cannot be deleted until terminal.",409);
      // Delete the project and its generated output, never shared source media.
      if (existing.outputId) {
        const output = asset(existing.outputId,owner);
        await unlink(output.path).catch((error: NodeJS.ErrnoException) => {
          if(error.code !== "ENOENT") throw error;
        });
        db.prepare("DELETE FROM assets WHERE id=? AND owner=?").run(existing.outputId,owner);
      }
      db.prepare("DELETE FROM jobs WHERE id=? AND owner=?").run(id,owner);
      return json({deleted:true});
    }
    if (route === "jobs" && id && method === "PATCH") {
      const j = job(id, owner),
        b = await body(req);
      if (b.cancel === true)
        return json(transition(j.id, "cancelled", { stage: "Cancelled" }));
      if (b.saved === true) {
        j.saved = true;
        saveJob(j);
        return json(j);
      }
      throw new AppError("Unsupported project action.");
    }
    if (route === "account" && method === "DELETE") {
      if (
        list<Job>("jobs", owner).some((j) =>
          ["queued", "processing"].includes(j.status),
        )
      )
        throw new AppError(
          "Wait for active generations to finish before deleting data.",
          409,
        );
      removeOfflinePlans(dataDir, owner);
      for (const a of list<Asset>("assets", owner))
        await unlink(a.path).catch(() => {});
      for (const table of ["assets", "artists", "jobs", "ledger", "sessions"])
        db.prepare(`DELETE FROM ${table} WHERE owner=?`).run(owner);
      const response = json({ deleted: true });
      response.cookies.delete("sm_session");
      return response;
    }
    if (route === "admin") {
      if (
        process.env.NODE_ENV === "production" ||
        process.env.ADMIN_DEMO_ENABLED !== "true" ||
        !process.env.ADMIN_DEMO_ACCESS_KEY
      )
        throw new AppError("Admin access is disabled.", 403);
      if (method === "POST" && id === "login") {
        limit(`${owner}:admin`, 5, 15 * 60000);
        limit("admin:global", 20, 15 * 60000);
        const b = await body(req);
        const key = string(b.key, 500);
        const hash = (v: string) => createHash("sha256").update(v).digest();
        if (
          !timingSafeEqual(hash(key), hash(process.env.ADMIN_DEMO_ACCESS_KEY))
        )
          throw new AppError("Access denied.", 403);
        grantAdmin(token!);
        db.prepare("INSERT INTO audit VALUES (?,?,?,?)").run(
          randomUUID(),
          owner,
          "demo_admin_login",
          Date.now(),
        );
        return json({ ok: true });
      }
      if (!auth.admin)
        throw new AppError("Administrator authorization required.", 403);
      if (method === "GET") return json({ demo: true, actionsEnabled: false });
      throw new AppError(
        "Financial and customer administration actions are disabled.",
        403,
      );
    }
    throw new AppError("Not found.", 404);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error("API error", e instanceof Error ? e.message : "Unknown");
    return json(
      { error: "The operation could not be completed. Please try again." },
      500,
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
