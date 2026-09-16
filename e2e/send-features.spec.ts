import { expect, test } from "./test";

test("sender handles multiple files and shows the bundle list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "تصفّح الملفات" }).click();
  await page.setInputFiles('input[type="file"]', [
    {
      name: "one.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("الملف الأول ".repeat(2000)),
    },
    {
      name: "two.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,value\nqrf,1\n".repeat(1000)),
    },
    {
      name: "three.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256)),
    },
  ]);

  await expect(page.getByText("one.txt")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("two.csv")).toBeVisible();
  await expect(page.getByText("three.bin")).toBeVisible();
  await expect(page.getByText("3 ملف مختار")).toBeVisible();
  await expect(page.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });
});

test("sender converts pasted text into a transfer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "نص" }).click();
  await page.getByPlaceholder(/الصق النص هنا/).fill("رسالة سرية عاجلة ".repeat(2000));
  await page.getByRole("button", { name: "تحويل إلى نقل" }).click();
  await expect(page.getByText("جاهز للبث")).toBeVisible({ timeout: 60_000 });
});

test("sender can create and select a custom preset", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /بروفايل مخصص/ }).click();
  await page.getByLabel("اسم البروفايل").fill("سريع-ليلي");
  await page.getByLabel("معدل الإطارات (fps)").fill("20");
  await page.getByRole("button", { name: "حفظ البروفايل" }).click();
  await expect(page.getByText("سريع-ليلي ⭐")).toBeVisible();
  const customPresetRadio = page
    .locator('button[role="radio"]')
    .filter({ hasText: "سريع-ليلي" });
  await customPresetRadio.click();
  await expect(customPresetRadio).toHaveAttribute("aria-checked", "true");
});

test("language switch flips the interface to English and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Switch language/ }).click();
  await expect(page.getByRole("link", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Move a file/ })).toBeVisible();
  await page.getByRole("button", { name: /Switch language/ }).click();
  await expect(page.getByRole("link", { name: "إرسال" })).toBeVisible();
});

test("broadcast mode toggles and highlights the stage", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /بث جماعي/ }).click();
  await expect(page.locator("main.broadcast-active")).toBeVisible();
});
