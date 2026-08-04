import { expect, test } from "@playwright/test";
import { installCameraStub } from "./helpers/camera-stub";

const PEER_HOST = { host: "localhost", port: 9000, path: "/", secure: false };

test("progress updates are throttled (not per-chunk) during a large transfer", async ({
  context,
}) => {
  test.setTimeout(120_000);
  await context.addInitScript((h) => {
    localStorage.setItem("qrferry-peer-host", JSON.stringify(h));
  }, PEER_HOST);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("qrferry-tour-seen-v1", "1");
    } catch {
      /* ignore */
    }
  });

  const tvPage = await context.newPage();
  await tvPage.goto("/tv");
  await tvPage.waitForFunction(() => !!window.__qrferryTvInfo, null, { timeout: 20_000 });

  const phonePage = await context.newPage();
  await phonePage.addInitScript(installCameraStub);
  await phonePage.goto("/");

  // ملف 25MB = 100 شريحة (256KB)
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/big25.bin", Buffer.alloc(25 * 1024 * 1024, 5));
  await phonePage.setInputFiles('input[type="file"]', "/tmp/big25.bin");

  const modules = await tvPage.evaluate(() => window.__qrferryTvModules!);
  await phonePage.evaluate(
    (fr) => window.__qrferrySetFrames([{ n: fr.n, data: new Uint8Array(fr.data) }]),
    modules,
  );

  // نراقب عدد التحديثات الفعلية لنص التقدم عبر MutationObserver (موثوق)
  await tvPage.evaluate(() => {
    (window as unknown as { __progressUpdates: number }).__progressUpdates = 0;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" || mutation.type === "childList") {
          (window as unknown as { __progressUpdates: number }).__progressUpdates += 1;
        }
      }
    });
    const target = document.querySelector(".tv-progress-text");
    if (target) {
      observer.observe(target, { characterData: true, childList: true, subtree: true });
    }
    (window as unknown as { __progressObserver?: MutationObserver }).__progressObserver = observer;
  });

  await phonePage.locator(".fast-action").click();
  await phonePage.getByRole("button", { name: "ابدأ المسح" }).click();

  await expect(phonePage.getByText(/اكتمل الإرسال/)).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => tvPage.evaluate(() => window.__qrferryTvReceived?.size ?? null), { timeout: 30_000 })
    .toBe(25 * 1024 * 1024);

  const updates = await tvPage
    .evaluate(() => (window as unknown as { __progressUpdates: number }).__progressUpdates ?? 0)
    .catch(() => 0);
  // 100 شريحة لكن التحديثات مخففة (~كل 120ms) — يجب أن تكون أقل من 100 بوضوح
  console.log(`progress updates observed: ${updates} (chunks=100)`);
  expect(updates).toBeLessThan(100);
});
