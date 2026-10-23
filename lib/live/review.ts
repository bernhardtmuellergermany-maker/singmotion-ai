import { open, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { validateAudio } from "../media.ts";
import { sha256File, validateReference } from "./media.ts";
import type { Attempt } from "./store.ts";

export async function readDraftFile(file: string): Promise<unknown> {
  const handle = await open(file, "r");
  try {
    const bytes = Buffer.alloc(32769);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 32768) throw new Error("Draft export exceeds 32 KiB.");
    // PowerShell's UTF-8 export may include a BOM.
    try {
      return JSON.parse(
        bytes
          .subarray(0, bytesRead)
          .toString("utf8")
          .replace(/^\uFEFF/, ""),
      );
    } catch {
      throw new Error("Draft must be a UTF-8 Studio JSON export.");
    }
  } finally {
    await handle.close();
  }
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Private, script-free, self-contained review. Never serves application assets. */
export async function writeOfflineReview(attempt: Attempt, dataDir: string) {
  if (
    attempt.state !== "prepared" ||
    attempt.upperBoundMicroUsd !== null ||
    attempt.contractRevision !== null
  )
    throw new Error("Offline review requires an unpriced, unapproved plan.");
  const media = attempt.media;
  await validateReference(media.imagePath);
  const image = await readFile(media.imagePath);
  const format = (await sharp(image).metadata()).format;
  const duration = await validateAudio(media.audioPath, true);
  if (
    createHash("sha256").update(image).digest("hex") !== media.imageSha256 ||
    (await sha256File(media.audioPath)) !== media.audioSha256 ||
    duration !== media.durationSeconds ||
    (format !== "png" && format !== "jpeg")
  )
    throw new Error("Prepared review inputs changed.");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer"><title>SingMotion offline review</title>
<style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:20px;color:#181b32;background:#fafafa}img{max-width:100%;max-height:420px}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}section{padding:20px;background:white;border:1px solid #ddd;border-radius:12px;margin:16px 0}</style>
<h1>SingMotion offline draft review</h1><p>Unpriced · Not authorizable · No job enqueued · No provider upload or submission</p>
<section><h2>Selected reference</h2><img alt="Selected private reference image" src="data:image/${format};base64,${image.toString("base64")}"></section>
<section><h2>Prepared MP3</h2><p>Measured encoded duration: <strong>${duration} seconds</strong></p></section>
<section><h2>Composed English prompt</h2><p>English confirmation: ${media.promptLanguageConfirmed ? "operator-confirmed" : "not confirmed; review language manually"}</p><pre>${escape(media.prompt)}</pre></section>
<section><h2>Immutable input hashes (SHA-256)</h2><p>Audio: <code>${escape(media.audioSha256)}</code></p><p>Image: <code>${escape(media.imageSha256)}</code></p><p>Plan: <code>${escape(attempt.id)}</code></p></section>
<p>Billing contract and cost ceiling are unknown. This report is private and contains your reference image and prompt. It grants no authorization.</p></html>`;
  const directory = path.join(dataDir, "operator-reviews");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${attempt.id}.html`);
  try {
    await writeFile(file, html, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      (await readFile(file, "utf8")) !== html
    )
      throw new Error(
        "Review file already exists with different contents or cannot be written.",
      );
  }
  return file;
}
