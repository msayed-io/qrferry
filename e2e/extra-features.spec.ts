import { expect, test } from "./test";

test("password QR modal opens and renders a QR canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "الخصوصية وخيارات إضافية" }).click();
  await page.getByRole("button", { name: /تشفير الملف/ }).click();
  await page.getByLabel("كلمة المرور").fill("سر-1234");
  await page.getByRole("button", { name: "اعرض كلمة المرور كـ QR" }).click();
  await expect(page.getByText("رمز كلمة المرور")).toBeVisible();
  // ننتظر ظهور canvas داخل النافذة (يُولد QR فعلياً)
  await expect(page.locator(".modal-card canvas")).toBeVisible({ timeout: 20_000 });
});

test("keyboard shortcut Space toggles broadcast when a transfer is ready", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', {
    name: "shortcut.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("اختبار الاختصارات ".repeat(3000)),
  });
  await expect(page.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Space");
  await expect(page.getByText("جارٍ البث")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByText("جاهز للبث")).toBeVisible();
});

test("offline package page downloads a zip", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByText("حزمة النشر الأوفلاين")).toBeVisible();
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "تحميل الحزمة الأوفلاين" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
});
