import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Journeys run the runtime in-process; keep their trust decisions out of the user's configuration.
// The runner always makes a fresh home, never a developer's CODE_FACTORY_HOME. Workers load this
// file again with the runner's environment; the marker names the runner's home, so they keep it.
if (
  !process.env.CODE_FACTORY_HOME ||
  process.env.CODE_FACTORY_E2E_HOME_SET !== process.env.CODE_FACTORY_HOME
) {
  process.env.CODE_FACTORY_HOME = mkdtempSync(join(tmpdir(), "code-factory-e2e-home-"));
  process.env.CODE_FACTORY_E2E_HOME_SET = process.env.CODE_FACTORY_HOME;
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
