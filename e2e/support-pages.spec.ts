import { expect, test, type Page } from "./test";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

test.use({ serviceWorkers: "block" });

const routes = ["history", "offline", "privacy"] as const;
for (const route of routes)
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [844, 390],
    [1440, 900],
    [3840, 2160],
  ]) {
    test(`UI7 /${route} shares the brand and has a visible working home link at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${route}`);
      await expect(
        page.getByText("QRFERRY-UI-7", { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(`.support-nav a[href="/${route}"]`),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        page.locator(".workspace-nav [aria-current=page]"),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await expect(page.locator(".support-card").first()).toHaveCSS(
        "background-color",
        "rgb(255, 255, 255)",
      );
      await expect(page.locator(".support-card").first()).toHaveCSS(
        "border-radius",
        "3px",
      );
      const home = page.getByRole("link", {
        name: "الرجوع للرئيسية",
        exact: true,
      });
      await expect(home).toHaveAttribute("href", "/");
      const box = await home.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.y + box!.height).toBeLessThan(height);
      await home.click();
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "أرسل ملفاتك." }),
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

test("UI7 history preserves records and fields; clearing requires confirmation and survives reload", async ({
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

test("UI7 offline download is a real ZIP with the current privacy page; failures are inline and retryable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/offline");
  await page.route("**/scan", (route) =>
    route.fulfill({ status: 503, body: "test unavailable" }),
  );
  await page.getByRole("button", { name: "تحميل الحزمة الأوفلاين" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "تعذّر تجهيز الحزمة",
  );
  await expect(
    page.getByRole("button", { name: "تحميل الحزمة الأوفلاين" }),
  ).toBeEnabled();
  await page.unroute("**/scan");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "تحميل الحزمة الأوفلاين" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/qrferry-offline-.*\.zip$/);
  const files = unzipSync(await fs.readFile((await d.path())!));
  for (const name of ["index.html", "scan.html", "privacy.html", "READ-ME.txt"])
    expect(files[name]).toBeTruthy();
  expect(strFromU8(files["privacy.html"])).toContain("الرجوع للرئيسية");
  expect(strFromU8(files["privacy.html"])).toContain("QRFERRY-UI-7");
  await expect(page.getByRole("status")).toContainText(
    "تم تجهيز الحزمة وطلب تنزيلها",
  );
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

for (const route of routes)
  test(`UI7 /${route} supports English, larger text, and navigation without browser history`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${route}`);
    await page
      .getByRole("button", { name: "Switch language / تبديل اللغة" })
      .click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(
      page.getByRole("link", { name: "Back to home", exact: true }),
    ).toBeVisible();
    await page.addStyleTag({
      content: ".support-page{font-size:32px!important}",
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Back to home", exact: true }),
    ).toBeVisible();
    await page.locator('.support-nav a[href="/privacy"]').click();
    await expect(
      page.getByRole("heading", { name: "Privacy policy", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to home", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Send your files." }),
    ).toBeVisible();
  });
