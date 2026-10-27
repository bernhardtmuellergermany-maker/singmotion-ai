import { test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("four-step product: real local uploads, responsive desktop/mobile and mocked paid boundary", async () => {
  test.setTimeout(240000);
  await promisify(execFile)(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "tests/product.browser.ts"],
    {
      env: { ...process.env, PRODUCT_TEST_ORIGIN: "http://127.0.0.1:3100" },
      timeout: 230000,
      maxBuffer: 1024 * 1024,
    },
  );
});
