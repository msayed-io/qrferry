import { expect, test } from "./test";

test("password QR modal opens and renders a QR canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "الخصوصية وخيارات إضافية" }).click();
  await page.getByRole("switch", { name: /تشفير الملف/ }).click();
  await page.getByLabel("كلمة المرور").fill("سر-1234");
  await page.getByRole("button", { name: "اعرض كلمة المرور كـ QR" }).click();
  await expect(page.getByText("رمز كلمة المرور")).toBeVisible();
  // ننتظر ظهور canvas داخل النافذة (يُولد QR فعلياً)
  await expect(page.locator(".modal-card canvas:not(.qf-specular-rim)")).toBeVisible({ timeout: 20_000 });
});

test("keyboard shortcut Space toggles broadcast when a transfer is ready", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]:not([webkitdirectory])', {
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

test('removed offline package renders not found',async({page})=>{
  await page.goto('/offline');await expect(page.getByRole('heading',{name:/404/})).toBeVisible();
});
