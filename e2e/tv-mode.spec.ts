import { expect, test } from "@playwright/test";

test("TV page shows compatibility panel and receiver QR", async ({ page }) => {
  await page.goto("/tv");
  await expect(page.getByText("امسح هذا الرمز من هاتفك")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("فحص توافق الجهاز")).toBeVisible();
  // فتح تفاصيل التوافق
  await page.getByText("فحص توافق الجهاز").click();
  await expect(page.getByText(/مدعوم|غير مدعوم/).first()).toBeVisible();
  // رمز الاقتران معروض
  await expect(page.locator(".tv-qr-box canvas")).toBeVisible();
});

test("TV page custom signaling host applies and persists", async ({ page }) => {
  await page.goto("/tv");
  await expect(page.getByText("امسح هذا الرمز من هاتفك")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel("خادم التسيير المخصص (لشبكة معزولة)").fill("ws://192.168.1.50:9000/peerjs");
  await page.getByRole("button", { name: "تطبيق" }).click();
  await expect(page.getByText("تم تطبيق خادم التسيير")).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem("qrferry-peer-host"));
  expect(stored).toContain("192.168.1.50");
  expect(stored).toContain("9000");
});

test("TV page remote navigation moves focus between buttons", async ({ page }) => {
  await page.goto("/tv");
  await expect(page.getByText("امسح هذا الرمز من هاتفك")).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".tv-btn").first().focus();
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
  // التركيز انتقل لعنصر قابل للتفاعل (زر أو حقل إدخال)
  expect(afterId).toMatch(/BUTTON\.|INPUT\./);
});
