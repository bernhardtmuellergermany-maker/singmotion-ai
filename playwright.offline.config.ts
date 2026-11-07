import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "offline-review.spec.ts",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    env: {
      PORT: "3101",
      NODE_ENV: "production",
      DEMO_MODE: "true",
      GENERATIONS_ENABLED: "false",
      ADMIN_DEMO_ENABLED: "false",
      BYTEPLUS_LIVE_TEST_ENABLED: "false",
      STAGING_AUTH_ENABLED: "false",
      DATA_DIR: path.join(tmpdir(), `singmotion-offline-browser-${Date.now()}`),
    },
  },
});
