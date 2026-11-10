import { expect, test, type Page } from "./test";

test.use({ serviceWorkers: "block" });

const routes = ["history", "privacy"] as const;
for (const route of routes)
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [844, 390],
    [1440, 900],
    [3840, 2160],
  ]) {
    test(`Mulberry /${route} shares the brand and has a visible working home link at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${route}`);
      await expect(page.locator('.app-header,.bottom-nav')).toHaveCount(0);
      await expect(page.locator('.support-toolbar > *')).toHaveCount(2);
      await expect(page.locator('.support-title h1')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await expect(page.locator(".support-card").first()).toHaveCSS(
        "background-color",
        "rgb(255, 253, 255)",
      );
      await expect(page.locator(".support-card").first()).toHaveCSS(
        "border-radius",
        "28px",
      );
      const home = page.getByRole("button", {
        name: "الرجوع إلى التطبيق",
        exact: true,
      });
      const box = await home.boundingBox();
      expect(box!.height).toBe(40);
      await expect(home).toHaveCSS("position", "relative");
      expect(await home.evaluate(el => getComputedStyle(el, "::before").inset)).toBe("-2px");
      expect(box!.y + box!.height).toBeLessThan(height);
      await home.click();
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "إرسال", exact: true }),
      ).toBeVisible();
    });
  }

async function seedHistory(page: Page) {
  await page.goto("/history");
  await expect(
    page.getByText("لا توجد نقولات بعد.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("qrferry-history", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("entries", "readwrite");
        [1, 2, 3].forEach((i) =>
          tx.objectStore("entries").add({
            name:
              i === 3
                ? "تقرير طويل جدًا ".repeat(12) + ".txt"
                : `record-${i}.txt`,
            size: i * 1024,
            fileCount: i,
            time: 1789732800000 + i,
            encrypted: i === 3,
            signed: i === 2,
            verified: true,
          }),
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator(".history-item")).toHaveCount(3);
}

test("Mulberry history preserves records and fields; clearing requires confirmation and survives reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seedHistory(page);
  await expect(page.locator(".history-item").first()).toContainText(
    "تقرير طويل جدًا",
  );
  await expect(page.locator(".history-item").first()).toContainText("مشفَّر");
  await expect(
    page.locator(".history-item").first().locator("time"),
  ).toHaveAttribute("datetime", /2026/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.getByRole("button", { name: "مسح السجل", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "مسح السجل", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".history-item")).toHaveCount(3);
  await page.getByRole("button", { name: "مسح السجل", exact: true }).click();
  await page.getByRole("button", { name: "تأكيد المسح", exact: true }).click();
  await expect(
    page.getByText("لا توجد نقولات بعد.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".history-item")).toHaveCount(0);
  await page.getByRole("link", { name: "استقبال ملفات", exact: true }).click();
  await expect(page).toHaveURL(/\/scan$/);
});

test('removed offline package has no page or menu entry',async({page})=>{
  await page.goto('/offline');await expect(page.getByRole('heading',{name:/404/})).toBeVisible();
  await page.goto('/');await page.getByRole('button',{name:'قائمة التطبيق'}).click();
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await expect(page.getByRole('menuitem',{name:/أوفلاين|Offline/})).toHaveCount(0);
});

for (const route of routes)
  test(`Mulberry /${route} supports English, larger text, and navigation without browser history`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${route}`);
    await page.evaluate(()=>{Object.defineProperty(navigator,'languages',{configurable:true,get:()=>['en-US','ar']});window.dispatchEvent(new Event('languagechange'));});
    await expect(page.locator('html')).toHaveAttribute('dir','ltr');
    await expect(page.getByRole('button',{name:'Back to app',exact:true})).toBeVisible();
    await page.addStyleTag({content:'.support-page{font-size:32px!important}'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await page.getByRole('button',{name:'Back to app',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Send',exact:true})).toBeVisible();
  });
