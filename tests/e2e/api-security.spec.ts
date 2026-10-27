import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
const dir = mkdtempSync(path.join(tmpdir(), "singmotion-browser-"));
const song = path.join(dir, "my-song.wav"),
  image = path.join(dir, "reference.png");
test.beforeAll(async () => {
  execFileSync("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=12",
    "-y",
    song,
  ]);
  await sharp({
    create: { width: 500, height: 650, channels: 3, background: "#b8b1a4" },
  })
    .png()
    .toFile(image);
});
test("API rejects unauthenticated, cross-user, spoofed files, CSRF, missing consent and production admin", async ({
  playwright,
}) => {
  const baseURL = "http://127.0.0.1:3100",
    headers = { Origin: baseURL };
  const a = await playwright.request.newContext({ baseURL }),
    b = await playwright.request.newContext({ baseURL });
  expect((await a.get("/api/jobs")).status()).toBe(401);
  expect((await a.post("/api/session")).status()).toBe(403);
  expect((await a.post("/api/session", { headers })).status()).toBe(200);
  await b.post("/api/session", { headers });
  const invalid = await a.post("/api/assets", {
    headers,
    multipart: {
      kind: "audio",
      file: {
        name: "fake.mp3",
        mimeType: "audio/mpeg",
        buffer: Buffer.from("not an mp3"),
      },
    },
  });
  expect(invalid.status()).toBe(400);
  const response = await a.post("/api/assets", {
    headers,
    multipart: {
      kind: "audio",
      file: {
        name: "song.wav",
        mimeType: "audio/wav",
        buffer: readFileSync(song),
      },
    },
  });
  expect(response.status()).toBe(201);
  const asset = await response.json();
  expect(asset.path).toBeUndefined();
  expect((await b.get(`/api/assets/${asset.id}`)).status()).toBe(404);
  expect(
    (
      await a.post("/api/jobs", {
        headers,
        data: { songId: asset.id, consent: false },
      })
    ).status(),
  ).toBe(503);
  expect((await a.get("/api/admin")).status()).toBe(403);
  expect(
    (
      await a.post("/api/admin/login", {
        headers,
        data: { key: "not-a-secret" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await a.post("/api/artists", {
        headers: { Origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  await a.dispose();
  await b.dispose();
});

test("customer sessions enforce Origin, start without invented credit and persist private ownership", async ({
  playwright,
}) => {
  const baseURL = "http://127.0.0.1:3100",
    headers = { Origin: baseURL };
  const client = await playwright.request.newContext({ baseURL });
  const email = `account-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
    password = "offline-only account password long enough";
  try {
    expect(
      (
        await client.post("/api/account", {
          data: { action: "register", email, password },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await client.post("/api/account", {
          headers,
          data: { action: "register", email, password },
        })
      ).status(),
    ).toBe(200);
    const info = await (await client.get("/api/account")).json();
    expect(info.balanceCents).toBe(0);
    expect(info.paymentsEnabled).toBe(false);
    const owner = (
      await (await client.post("/api/session", { headers })).json()
    ).owner;
    expect(owner).toMatch(/^customer-/);
    await client.post("/api/account", { headers, data: { action: "logout" } });
    expect((await client.get("/api/jobs")).status()).toBe(401);
    expect(
      (
        await client.post("/api/account", {
          headers,
          data: { action: "login", email, password },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await client.post("/api/session", { headers })).json()).owner,
    ).toBe(owner);
    expect(
      (
        await client.post("/api/studio-live", {
          headers,
          data: { action: "submit", id: "guess" },
        })
      ).ok(),
    ).toBe(false);
  } finally {
    await client.dispose();
  }
});

test("EXIF-oriented uploads, saved formats and private draft ownership survive server round-trip", async ({
  playwright,
}) => {
  const baseURL = "http://127.0.0.1:3100",
    headers = { Origin: baseURL };
  const a = await playwright.request.newContext({ baseURL }),
    b = await playwright.request.newContext({ baseURL });
  try {
    const owner = (await (await a.post("/api/session", { headers })).json())
      .owner;
    await b.post("/api/session", { headers });
    const rotated = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#aabbcc" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const image = await (
      await a.post("/api/assets", {
        headers,
        multipart: {
          kind: "image",
          file: {
            name: "rotated.jpg",
            mimeType: "image/jpeg",
            buffer: rotated,
          },
        },
      })
    ).json();
    expect(image.width).toBe(720);
    expect(image.height).toBe(1280);
    const audio = await (
      await a.post("/api/assets", {
        headers,
        multipart: {
          kind: "audio",
          file: {
            name: "song.wav",
            mimeType: "audio/wav",
            buffer: readFileSync(song),
          },
        },
      })
    ).json();
    const id = `draft-${Date.now()}`;
    const selection = {
      version: 1,
      owner,
      songId: audio.id,
      imageId: image.id,
      start: 1.25,
      end: 5.25,
      outputFormat: "16:9",
      formatMode: "16:9",
      performance: "Natural",
      camera: "Static Close-Up",
      customPrompt: "",
    };
    expect(
      (
        await a.post("/api/studio-drafts", {
          headers,
          data: { id, selection, artistName: "EXIF test", step: 3 },
        })
      ).ok(),
    ).toBe(true);
    const restored = await (await a.get(`/api/studio-drafts/${id}`)).json();
    expect(restored.selection).toEqual(selection);
    expect(restored.image.width).toBe(720);
    expect((await b.get(`/api/studio-drafts/${id}`)).status()).toBe(404);
    expect((await b.get(`/api/assets/${image.id}`)).status()).toBe(404);
    expect(
      (
        await b.post("/api/studio-drafts", {
          headers,
          data: { id, selection, artistName: "Spoof", step: 3 },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
