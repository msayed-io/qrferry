import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";
export type { Page, BrowserContext } from "@playwright/test";
export const test = base.extend<{ tvTestHooks: void }>({
  tvTestHooks: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        window.__qrferryTestMode = true;
        localStorage.setItem("qrferry-tour-seen-v1", "1");
      });
      await use();
    },
    { auto: true },
  ],
});
