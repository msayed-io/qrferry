import { expect, test, type Page } from "@playwright/test";
import { installCameraStub } from "./helpers/camera-stub";

const PEER_HOST = { host: "localhost", port: 9000, path: "/", secure: false };

async function getTvInfo(page: Page): Promise<{ peerId: string; passcode: string; payload: string }> {
  await expect
    .poll(() => page.evaluate(() => window.__qrferryTvInfo ?? null), { timeout: 20_000 })
    .not.toBeNull();
  return page.evaluate(() => window.__qrferryTvInfo as { peerId: string; passcode: string; payload: string });
}

async function feedPairingQrToPhone(phonePage: Page, tvPage: Page): Promise<void> {
  // نستخرج مصفوفة وحدات QR من شاشة التلفزيون (نفس مكتبة العرض) ونغذي بها كاميرا الهاتف
  await expect
    .poll(() => tvPage.evaluate(() => window.__qrferryTvModules ?? null), { timeout: 20_000 })
    .not.toBeNull();
  const modules = await tvPage.evaluate(() => window.__qrferryTvModules as { n: number; data: number[] });
  const frame = { n: modules.n, data: new Uint8Array(modules.data) };
  await phonePage.evaluate(
    (fr) =>
      (window as unknown as { __qrferrySetFrames: (f: Array<{ n: number; data: Uint8Array }>) => void })
        .__qrferrySetFrames([fr]),
    frame,
  );
}

async function expectTvReceived(tvPage: Page, expectedBytes: Buffer, expectedName: string): Promise<void> {
  await expect
    .poll(() => tvPage.evaluate(() => window.__qrferryTvReceived?.size ?? null), { timeout: 30_000 })
    .toBe(expectedBytes.length);
  const received = await tvPage.evaluate(() => window.__qrferryTvReceived);
  expect(received?.name).toBe(expectedName);
  expect(Buffer.from(received?.bytes ?? [])).toEqual(expectedBytes);
}

test("fast transfer: phone sends a file to the TV receiver via pairing QR", async ({
  context,
}) => {
  await context.addInitScript((peerHost) => {
    localStorage.setItem("qrferry-peer-host", JSON.stringify(peerHost));
  }, PEER_HOST);

  // 1) صفحة التلفزيون: تعرض رمز الاقتران
  const tvPage = await context.newPage();
  await tvPage.goto("/tv");
  const tvInfo = await getTvInfo(tvPage);
  expect(tvInfo.peerId).toBeTruthy();
  expect(tvInfo.passcode).toMatch(/^\d{6}$/);

  // 2) صفحة الهاتف: كاميرا محاكاة + اختيار ملف
  const phonePage = await context.newPage();
  await phonePage.addInitScript(installCameraStub);
  await phonePage.goto("/");
  const buffer = Buffer.from("نقل سريع عبر الشبكة المحلية ".repeat(4000));
  await phonePage.setInputFiles('input[type="file"]', {
    name: "سريع.txt",
    mimeType: "text/plain",
    buffer,
  });
  await expect(phonePage.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });

  // 3) تغذية كاميرا الهاتف برمز الاقتران وبدء المسح
  await feedPairingQrToPhone(phonePage, tvPage);
  await phonePage.getByRole("button", { name: /نقل سريع/ }).click();
  await phonePage.getByRole("button", { name: "ابدأ المسح" }).click();

  // 4) انتظار اكتمال الإرسال والتحقق من البايتات على التلفزيون
  await expect(phonePage.getByText(/اكتمل الإرسال/)).toBeVisible({ timeout: 60_000 });
  await expectTvReceived(tvPage, buffer, "سريع.txt");
});

test("fast transfer: multi-file package is received on TV", async ({ context }) => {
  await context.addInitScript((peerHost) => {
    localStorage.setItem("qrferry-peer-host", JSON.stringify(peerHost));
  }, PEER_HOST);

  const tvPage = await context.newPage();
  await tvPage.goto("/tv");
  await getTvInfo(tvPage);

  const phonePage = await context.newPage();
  await phonePage.addInitScript(installCameraStub);
  await phonePage.goto("/");
  await feedPairingQrToPhone(phonePage, tvPage);

  await phonePage.setInputFiles('input[type="file"]', [
    { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("ألف ".repeat(2000)) },
    { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("باء ".repeat(3000)) },
  ]);
  await expect(phonePage.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });

  await phonePage.getByRole("button", { name: /نقل سريع/ }).click();
  await phonePage.getByRole("button", { name: "ابدأ المسح" }).click();
  await expect(phonePage.getByText(/اكتمل الإرسال/)).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(() => tvPage.evaluate(() => window.__qrferryTvReceived?.size ?? null), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const received = await tvPage.evaluate(() => window.__qrferryTvReceived);
  expect(received?.name).toMatch(/ملف مختار/);
});
