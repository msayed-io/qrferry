import { defineConfig } from "@playwright/test";

/**
 * إعداد اختبارات Playwright للنهاية-إلى-النهاية.
 * يُشغَّل خادم الإنتاج (vinext start) تلقائياً قبل الاختبارات.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

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
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--disable-gpu",
      ],
    },
  },
  webServer: {
    command: `PORT=${PORT} npm run start`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
