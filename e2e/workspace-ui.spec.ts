import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./test";
import { installCameraStub } from "./helpers/camera-stub";

const file = (name: string) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(`payload:${name}`),
});
const sizes = [
  [320, 568],
  [390, 844],
  [768, 1024],
  [844, 390],
  [1280, 720],
  [1920, 1080],
  [3840, 2160],
];
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
for (const [width, height] of sizes)
  for (const route of ["/", "/scan"]) {
    test(`UI6 ${route} is readable and responsive at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      await noOverflow(page);
      await expect(page.locator(".workspace-brand small")).toHaveText(
        "QRFERRY-UI-7",
      );
      await expect(
        page.locator(".workspace-nav a[aria-current=page]"),
      ).toHaveText(route === "/" ? "إرسال" : "مسح");
      await expect(
        page.locator(".tour-overlay,.sender-hero,.how-it-works,.scan-tips"),
      ).toHaveCount(0);
      expect((await page.locator("main").innerText()).length).toBeLessThan(
        route === "/" ? 650 : 350,
      );
      const panel = page.locator(
        route === "/" ? ".control-panel" : ".camera-card",
      );
      await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(panel).toHaveCSS("color", "rgb(17, 24, 32)");
      await expect(panel).toHaveCSS("border-radius", "3px");
      const action = page
        .locator(
          route === "/"
            ? ".drop-zone .file-button"
            : ".camera-actions .primary-action",
        )
        .first();
      const rect = await action.boundingBox();
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      if (height >= 568)
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(height);
      if (route === "/") {
        await expect(
          page.locator(".privacy-settings .workspace-disclosure-toggle"),
        ).toHaveAttribute("aria-expanded", "false");
        await page.setInputFiles("input[type=file]", [
          file(
            "اسم ملف طويل جدًا لاختبار عدم خروج الاسم أو أزرار الحذف عن حدود البطاقة.txt",
          ),
          file("second.txt"),
          file("third.txt"),
        ]);
        await expect(page.locator(".batch-file")).toHaveCount(3);
        await expect(page.locator(".stream-status strong")).toHaveText(
          "جاهز للبث",
        );
        await expect(page.locator(".stream-status > div")).toHaveCSS(
          "color",
          "rgb(17, 24, 32)",
        );
        await expect(page.locator(".broadcast-progress strong")).toHaveCSS(
          "color",
          "rgb(17, 24, 32)",
        );
        await expect(page.locator(".fast-action")).toBeEnabled();
        await expect(page.locator(".fast-action")).toHaveCSS(
          "background-color",
          "rgb(231, 255, 84)",
        );
        await noOverflow(page);
      } else {
        await expect(
          page.locator(".camera-settings .workspace-disclosure-toggle"),
        ).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator(".channel-diagnostics")).not.toBeVisible();
      }
    });
  }

test("UI6 disclosures preserve input values, hide controls from tab order and return focus", async ({
  page,
}) => {
  await page.goto("/");
  const disclosure = page.locator(
    ".privacy-settings .workspace-disclosure-toggle",
  );
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /تشفير الملف/ }).click();
  const password = page.getByLabel("كلمة المرور", { exact: true });
  await password.fill("a-password-123");
  await page.keyboard.press("Escape");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(disclosure).toBeFocused();
  await expect(password).not.toBeVisible();
  await disclosure.click();
  await expect(password).toHaveValue("a-password-123");
});

for (const [width, height] of [
  [390, 844],
  [844, 390],
]) {
  test(`UI6 fast-transfer modal fits ${width}x${height}, traps focus and restores it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.setInputFiles("input[type=file]", file("modal.txt"));
    await expect(page.locator(".stream-status strong")).toHaveText("جاهز للبث");
    await page.locator(".fast-action").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    await page.keyboard.press("Space");
    await expect(page.locator(".stream-status strong")).toHaveText("جاهز للبث");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "إغلاق النافذة", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "إلغاء", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".fast-action")).toBeFocused();
    await noOverflow(page);
  });
}

test("UI6 camera permission failure is prominent and offers a working retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(installCameraStub);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let denied = true;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (denied) {
        denied = false;
        return Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        );
      }
      return original(constraints);
    };
  });
  await page.goto("/scan");
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect(page.locator(".error-message")).toBeVisible();
  const retry = page.getByRole("button", {
    name: "إعادة المحاولة",
    exact: true,
  });
  const box = await retry.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(844);
  await retry.click();
  await expect(
    page.getByRole("button", { name: "إيقاف الكاميرا", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".error-message")).toHaveCount(0);
});

test("UI6 camera modes remain usable and stopping fast scanning returns to its start screen", async ({
  page,
}) => {
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page
    .getByRole("button", { name: "إعدادات الكاميرا", exact: true })
    .click();
  await page.getByRole("radio", { name: /مسار مزدوج/ }).click();
  await expect(page.locator(".camera-view")).toHaveClass(/dual/);
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect(page.getByRole("radio", { name: /مسار مزدوج/ })).toBeDisabled();
  await page
    .getByRole("button", { name: "إيقاف الكاميرا", exact: true })
    .click();
  await expect(page.getByRole("radio", { name: /مسار مزدوج/ })).toBeEnabled();
  await page.goto("/");
  await page.setInputFiles("input[type=file]", file("camera.txt"));
  await page.locator(".fast-action").click();
  await page.getByRole("button", { name: "ابدأ المسح", exact: true }).click();
  await expect(page.locator(".fast-video")).toBeVisible();
  await page.getByRole("button", { name: "إيقاف المسح", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ابدأ المسح", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".fast-video")).not.toBeVisible();
  await page
    .getByRole("button", { name: "إغلاق النافذة", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("UI6 mobile completed scan exposes exact individual downloads and restart", async ({
  page,
}) => {
  const fixtures = JSON.parse(
    readFileSync(new URL("../.e2e/fixtures.json", import.meta.url), "utf8"),
  );
  const fixture = fixtures.multiPackage;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page.evaluate(
    (frames) => window.__qrferrySetFrames(frames),
    fixture.frames.map((f: { n: number; dataB64: string }) => ({
      n: f.n,
      data: new Uint8Array(Buffer.from(f.dataB64, "base64")),
    })),
  );
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "تم استرداد الملف.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".camera-card")).not.toBeVisible();
  await expect(page.locator(".handsfree-tip")).not.toBeVisible();
  await expect(page.locator(".rate-panel")).not.toBeVisible();
  const firstDownload = await page
    .locator(".received-files a")
    .first()
    .boundingBox();
  expect(firstDownload!.y + firstDownload!.height).toBeLessThan(844);
  const fs = await import("node:fs/promises");
  for (const f of fixture.files) {
    const link = page
      .locator(".received-files a")
      .filter({ hasText: "تنزيل" })
      .and(page.locator(`[download="${f.name}"]`));
    const download = page.waitForEvent("download");
    await link.click();
    const d = await download;
    expect(d.suggestedFilename()).toBe(f.name);
    expect(await fs.readFile((await d.path())!)).toEqual(
      Buffer.from(f.bytesB64, "base64"),
    );
  }
  await noOverflow(page);
  await page.evaluate(() => window.__qrferrySetFrames([]));
  await page.getByRole("button", { name: /مسح نقل آخر/ }).click();
  await expect(page.locator(".camera-view.active")).toBeVisible();
});

for (const route of ["/", "/scan"])
  test(`UI6 ${route} English and 200% text remain usable`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await page.getByRole("button", { name: /Switch language/ }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator(".workspace-intro h1")).toHaveText(
      route === "/" ? "Send your files." : "Receive your files.",
    );
    await page.addStyleTag({
      content: ".transfer-page {font-size:32px!important}",
    });
    await noOverflow(page);
    await expect(
      page.locator(".workspace-nav a[aria-current=page]"),
    ).toHaveText(route === "/" ? "Send" : "Scan");
  });

test("UI6 file inputs survive tab changes and a completed batch has no redundant picker", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles("input[type=file]", file("first.txt"));
  await expect(page.locator(".batch-add")).toBeEnabled();
  await expect(page.locator(".drop-zone")).not.toBeVisible();
  await page.getByRole("tab", { name: "نص", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".batch-add").click();
  await (await chooser).setFiles([file("second.txt"), file("third.txt")]);
  await expect(
    page.getByRole("tab", { name: "ملف", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".batch-file")).toHaveCount(3);
  await expect(page.locator(".batch-add")).not.toBeVisible();
  await expect(page.locator(".fast-action")).toBeEnabled();
});
