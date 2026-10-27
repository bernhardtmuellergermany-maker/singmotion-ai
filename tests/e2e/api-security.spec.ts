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
