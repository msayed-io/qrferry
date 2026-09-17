import { expect, test } from "./test";

test("sender turns a selected file into a live QR stream", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "أرسل ملفاتك." }),
  ).toBeVisible();

  const buffer = Buffer.from("QRFerry تجربة إرسال عربي ".repeat(8000));
  await page.setInputFiles('input[type="file"]', {
    name: "message.txt",
    mimeType: "text/plain",
    buffer,
  });

  await expect(page.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "ابدأ بثّ QR" }).click();
  await expect(page.getByText("جارٍ البث")).toBeVisible();
  await page.waitForTimeout(2500);

  const darkPixels = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas || canvas.width === 0) return 0;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 120) dark += 1;
    }
    return dark;
  });
  expect(darkPixels).toBeGreaterThan(500);
});

test("sender can encrypt the file with a password", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "الخصوصية وخيارات إضافية" }).click();
  await page.getByRole("button", { name: /تشفير الملف/ }).click();
  const passwordInput = page.getByLabel("كلمة المرور");
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill("كلمة-سرية-123");

  const buffer = Buffer.from("محتوى سري للاختبار ".repeat(4000));
  await page.setInputFiles('input[type="file"]', {
    name: "secret.txt",
    mimeType: "text/plain",
    buffer,
  });

  await expect(page.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".encrypted-badge")).toBeVisible();
  // لا يمكن بدء البث بكلمة مرور قصيرة
  await passwordInput.fill("12");
  await expect(page.getByText(/كلمة المرور يجب ألا تقل عن 4/)).toBeVisible();
});
