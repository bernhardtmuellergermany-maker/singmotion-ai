import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  // Previous three-step UI specs remain in the repository as historical coverage.
  // The five-step product suite replaces their obsolete selectors; API security stays active.
  testMatch: ["api-security.spec.ts", "product.spec.ts"],
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
      testIgnore: ["product.spec.ts"],
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
      CUSTOMER_ACCOUNTS_ENABLED: "true",
      STAGING_AUTH_ENABLED: "false",
      GENERATIONS_ENABLED: "false",
      DATA_DIR: `/tmp/singmotion-e2e-${Date.now()}`,
    },
  },
});
