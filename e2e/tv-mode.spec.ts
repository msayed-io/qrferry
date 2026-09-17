import { expect, test } from "./test";

test("TV page shows the pairing QR with horizontally aligned steps", async ({
  page,
}) => {
  await page.goto("/tv");
  await expect(page.getByText("امسح هذا الرمز من هاتفك")).toBeVisible({
    timeout: 20_000,
  });
  // رمز الاقتران معروض
  await expect(page.locator(".tv-qr-box canvas")).toBeVisible();
  // الخطوات عرضية (كل خطوة بسطر أفقي بنقطة ترقيم)
  await expect(page.locator(".tv-steps li[data-n='1']")).toBeVisible();
  await expect(page.locator(".tv-steps li[data-n='3']")).toBeVisible();
  // في RTL (العربية): مربع QR أول عنصر في الـ grid = يمين الشاشة،
  // والتعليمات على اليسار. نتحقق أن QR أعلى يساراً من التعليمات (يمين فعلياً).
  const qrBox = page.locator(".tv-qr-box");
  const qrBoxLeft = await qrBox.boundingBox();
  const instructions = page.locator(".tv-instructions");
  const instLeft = await instructions.boundingBox();
  expect(qrBoxLeft!.x).toBeGreaterThan(instLeft!.x);
});

test("TV page custom signaling host applies and persists", async ({ page }) => {
  await page.goto("/tv");
  await expect(page.getByText("امسح هذا الرمز من هاتفك")).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".tv-settings-button").click();
  await page
    .getByLabel("خادم التسيير المخصص (لشبكة معزولة)")
    .fill("ws://192.168.1.50:9000/peerjs");
  await page.getByRole("button", { name: "تطبيق" }).click();
  await expect(page.getByText("تم تطبيق خادم التسيير")).toBeVisible();
  const stored = await page.evaluate(() =>
    localStorage.getItem("qrferry-peer-host"),
  );
  expect(stored).toContain("192.168.1.50");
  expect(stored).toContain("9000");
});

test("TV page remote navigation moves focus between buttons", async ({
  page,
}) => {
  await page.goto("/tv");
  await expect(page.getByText("امسح هذا الرمز من هاتفك")).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".tv-settings-button").click();
  await page.locator(".tv-signal-apply").focus();
  const beforeId = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? `${el.tagName}.${el.className}` : "none";
  });
  await page.keyboard.press("ArrowRight");
  const afterId = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? `${el.tagName}.${el.className}` : "none";
  });
  expect(afterId).not.toBe("none");
  expect(afterId).not.toBe(beforeId);
});

test("TV page is blocked on phone-sized touch screens", async ({ page }) => {
  // محاكاة هاتف: شاشة صغيرة + مؤشر coarse
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // نحاكي pointer:coarse
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("coarse"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  });
  await page.goto("/tv");
  await expect(page.getByText("هذه الصفحة مخصصة للشاشات الكبيرة")).toBeVisible({
    timeout: 10_000,
  });
  // لا يبدأ المستقبِل على الهاتف
  await expect(
    page.evaluate(() => window.__qrferryTvInfo ?? null),
  ).resolves.toBeNull();
});
