import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1100 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 45000,
    env: {
      PORT: "3100",
      NODE_ENV: "production",
      DEMO_MODE: "true",
      STAGING_AUTH_ENABLED: "false",
      GENERATIONS_ENABLED: "true",
      DATA_DIR: `/tmp/singmotion-e2e-${Date.now()}`,
    },
  },
});
