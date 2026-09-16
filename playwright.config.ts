import { defineConfig } from "@playwright/test";

/**
 * إعداد اختبارات Playwright للنهاية-إلى-النهاية.
 * يُشغَّل خادم الإنتاج (vinext start) تلقائياً قبل الاختبارات.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

const browserEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);

export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  tsconfig: "./tsconfig.json",
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    launchOptions: {
      // Chromium on Linux POSIX locale replaces Unicode download names with "download".
      // Exercise real Arabic filenames under a deterministic UTF-8 filesystem locale.
      env:
        process.platform === "linux"
          ? { ...browserEnv, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }
          : browserEnv,
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--disable-gpu",
      ],
    },
  },
  webServer: {
    command: `E2E_PORT=${PORT} node scripts/e2e-servers.mjs`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
