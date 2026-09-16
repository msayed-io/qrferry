import { expect, test } from "./test";
import { installCameraStub } from "./helpers/camera-stub";

const PEER_HOST = { host: "localhost", port: 9000, path: "/", secure: false };

test("large file: 25MB fast transfer — measure each phase and detect failure", async ({
  context,
}) => {
  test.setTimeout(300_000);
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
  const tvErrs: string[] = [];
  tvPage.on("pageerror", (e) => tvErrs.push("TV-PAGE: " + e.message.slice(0, 200)));
  tvPage.on("console", (m) => {
    if (m.type() === "error") tvErrs.push("TV-CON: " + m.text().slice(0, 150));
  });
  await tvPage.goto("/tv");
  await tvPage.waitForFunction(() => !!window.__qrferryTvInfo, null, { timeout: 20_000 });

  const phonePage = await context.newPage();
  await phonePage.addInitScript(installCameraStub);
  await phonePage.goto("/");

  // ملف 25MB (على القرص — Playwright يرفض buffer >50MB)
  const big = Buffer.alloc(25 * 1024 * 1024, 5);
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/big25.bin", big);
  await phonePage.setInputFiles('input[type="file"]', "/tmp/big25.bin");

  const fastButton = phonePage.locator(".fast-action");
  await expect(fastButton).toBeEnabled({ timeout: 20_000 });

  const modules = await tvPage.evaluate(() => window.__qrferryTvModules!);
  await phonePage.evaluate(
    (fr) => window.__qrferrySetFrames([{ n: fr.n, data: new Uint8Array(fr.data) }]),
    modules,
  );

  const t0 = Date.now();
  await fastButton.click();
  await phonePage.getByRole("button", { name: "ابدأ المسح" }).click();

  // نراقب الحالة كل ثانيتين حتى النهاية أو الفشل
  let finalStatus = "";
  let result: "done" | "error" | "timeout" = "timeout";
  for (let i = 0; i < 60; i++) {
    await phonePage.waitForTimeout(2000);
    const s = await phonePage
      .evaluate(() => document.querySelector(".fast-status")?.textContent ?? "")
      .catch(() => "");
    const tvRecv = await tvPage
      .evaluate(() => window.__qrferryTvReceived?.size ?? null)
      .catch(() => null);
    const elapsed = Date.now() - t0;
    if (s.includes("اكتمل الإرسال")) {
      result = "done";
      finalStatus = s;
      console.log(`t=${elapsed}ms DONE. tvReceived=${tvRecv}`);
      break;
    }
    if (s.includes("تعذّر")) {
      result = "error";
      finalStatus = s;
      console.log(`t=${elapsed}ms ERROR: ${s}`);
      break;
    }
    if (i % 5 === 0) console.log(`t=${elapsed}ms status="${s.slice(0, 60)}" tvRecv=${tvRecv}`);
  }

  console.log("RESULT:", result, "|", finalStatus.slice(0, 120));
  console.log("TV RECEIVED SIZE:", await tvPage.evaluate(() => window.__qrferryTvReceived?.size ?? null));
  console.log("TV ERRORS:", JSON.stringify(tvErrs.slice(0, 6)));

  expect(result).toBe("done");
});
