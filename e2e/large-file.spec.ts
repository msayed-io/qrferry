import { expect, test } from "@playwright/test";

// تعطيل الجولة التعليمية (تظهر مرة واحدة كـ overlay وتعترض النقرات)
async function disableTour(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("qrferry-tour-seen-v1", "1");
    } catch {
      // تجاهل
    }
  });
}

test("large file: fast transfer is available immediately without heavy preparation", async ({
  page,
}) => {
  await disableTour(page);
  await page.goto("/");
  const buffer = Buffer.alloc(20 * 1024 * 1024, 7);
  await page.setInputFiles('input[type="file"]', {
    name: "big.bin",
    mimeType: "application/octet-stream",
    buffer,
  });

  // زر النقل السريع مفعّل فوراً (قراءة خام سريعة، لا تجهيز بصري)
  const fastButton = page.locator(".fast-action");
  await expect(fastButton).toBeEnabled({ timeout: 20_000 });

  // لم يُجهَّز البث البصري تلقائياً (لا توجد لوحة QR بعد)
  await expect(page.locator(".qr-stage canvas")).toHaveCount(0);

  // فتح نافذة النقل السريع (يعمل دون تجهيز)
  await fastButton.click();
  await expect(page.getByText("نقل سريع عبر الشبكة المحلية")).toBeVisible();
  await expect(page.getByRole("button", { name: "ابدأ المسح" })).toBeEnabled();
});

test("large file: pressing start QR stream triggers on-demand preparation", async ({
  page,
}) => {
  await disableTour(page);
  await page.goto("/");
  const buffer = Buffer.alloc(5 * 1024 * 1024, 3);
  await page.setInputFiles('input[type="file"]', {
    name: "medium.bin",
    mimeType: "application/octet-stream",
    buffer,
  });

  // لم يُجهَّز تلقائياً → زر البث يجهّز عند الضغط
  await page.locator(".qr-stage canvas").waitFor({ state: "detached" }).catch(() => undefined);
  await page.getByRole("button", { name: "ابدأ بثّ QR" }).click();
  await expect(page.getByText("جاهز للبث")).toBeVisible({ timeout: 120_000 });
});

test("small file still prepares automatically", async ({ page }) => {
  await page.goto("/");
  const buffer = Buffer.from("ملف صغير ".repeat(2000)); // ~14KB
  await page.setInputFiles('input[type="file"]', {
    name: "small.txt",
    mimeType: "text/plain",
    buffer,
  });
  await expect(page.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".fast-action")).toBeEnabled();
});

test("fast transfer moves a 10MB file quickly without optical preparation", async ({
  context,
}) => {
  // خادم PeerJS محلي للاختبارات (يُشغَّل عبر scripts/e2e-servers.mjs)
  await context.addInitScript((h) => {
    localStorage.setItem("qrferry-peer-host", JSON.stringify(h));
  }, { host: "localhost", port: 9000, path: "/", secure: false });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("qrferry-tour-seen-v1", "1");
    } catch {
      // تجاهل
    }
  });

  // صفحة التلفاز
  const tvPage = await context.newPage();
  await tvPage.goto("/tv");
  await tvPage.waitForFunction(() => !!window.__qrferryTvInfo, null, { timeout: 20_000 });

  // صفحة الهاتف بكاميرا محاكاة
  const phonePage = await context.newPage();
  const { installCameraStub } = await import("./helpers/camera-stub");
  await phonePage.addInitScript(installCameraStub);
  await phonePage.goto("/");

  // ملف 10MB
  const buffer = Buffer.alloc(10 * 1024 * 1024, 9);
  await phonePage.setInputFiles('input[type="file"]', {
    name: "big10.bin",
    mimeType: "application/octet-stream",
    buffer,
  });

  // زر النقل السريع مفعّل فوراً (لا تجهيز بصري)
  const fastButton = phonePage.locator(".fast-action");
  await expect(fastButton).toBeEnabled({ timeout: 20_000 });

  // تغذية رمز الاقتران وبدء النقل
  const modules = await tvPage.evaluate(() => window.__qrferryTvModules!);
  await phonePage.evaluate(
    (fr) => window.__qrferrySetFrames([{ n: fr.n, data: new Uint8Array(fr.data) }]),
    modules,
  );
  await fastButton.click();
  await phonePage.getByRole("button", { name: "ابدأ المسح" }).click();

  // النقل السريع يجب أن يكتمل بسرعة (لا انتظار تجهيز)
  const started = Date.now();
  await expect(phonePage.getByText(/اكتمل الإرسال/)).toBeVisible({ timeout: 60_000 });
  const elapsed = Date.now() - started;

  // التحقق من استلام 10MB على التلفاز
  await expect
    .poll(() => tvPage.evaluate(() => window.__qrferryTvReceived?.size ?? null), { timeout: 30_000 })
    .toBe(buffer.length);

  // وقت نقل 10MB عبر WebRTC المحلي يجب أن يكون قصيراً (أقل من 30 ثانية)
  expect(elapsed).toBeLessThan(30_000);
  console.log(`fast transfer 10MB completed in ${elapsed}ms`);
});
