import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { installCameraStub, readLastBlobBytes } from "./helpers/camera-stub";

type SerializedFrame = { n: number; dataB64: string };
type Fixture = {
  kind: "plain" | "package";
  frames: SerializedFrame[];
  files?: Array<{ name: string; mime: string; bytesB64: string }>;
  burn?: boolean;
  signed?: boolean;
  originalBytesB64?: string;
};

function loadFixtures(): Record<string, Fixture> {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".e2e", "fixtures.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

function decodeFrames(fixture: Fixture): Array<{ n: number; data: Uint8Array }> {
  return fixture.frames.map((frame) => ({
    n: frame.n,
    data: new Uint8Array(Buffer.from(frame.dataB64, "base64")),
  }));
}

async function setFrames(page: Page, fixture: Fixture) {
  await page.evaluate(
    (frames) =>
      (window as unknown as { __qrferrySetFrames: (f: Array<{ n: number; data: Uint8Array }>) => void })
        .__qrferrySetFrames(frames),
    decodeFrames(fixture),
  );
}

const fixtures = loadFixtures();

test("scanner receives a multi-file package and offers per-file downloads", async ({
  page,
}) => {
  const fixture = fixtures.multiPackage;
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await setFrames(page, fixture);

  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();
  await expect(page.getByText("تم استرداد الملف.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("تقرير.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("بيانات.csv", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /تنزيل الكل/ })).toBeVisible();

  const received = await readLastBlobBytes(page);
  expect(received).not.toBeNull();
});

test("scanner verifies a signed package after the user trusts the sender", async ({
  page,
}) => {
  const fixture = fixtures.signedPackage;
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await setFrames(page, fixture);

  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();
  await expect(page.locator(".sign-trust-panel strong")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/قسم الأمن/)).toBeVisible();
  await page.getByRole("button", { name: "أثق بهذا المرسل" }).click();

  await expect(page.getByRole("heading", { name: "تم استرداد الملف." })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/توقيع موثوق: قسم الأمن/)).toBeVisible();
});

test("scanner shows burn-after-reading notice for burn packages", async ({ page }) => {
  const fixture = fixtures.burnPackage;
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await setFrames(page, fixture);

  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();
  await expect(page.getByText("تم استرداد الملف.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/حذف بعد القراءة/)).toBeVisible();
});

test("completed transfers appear in the local history page", async ({ page }) => {
  const fixture = fixtures.historyPackage;
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await setFrames(page, fixture);
  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();
  await expect(page.getByText("تم استرداد الملف.")).toBeVisible({ timeout: 120_000 });

  await page.goto("/history");
  await expect(page.getByText("سجل النقل المحلي")).toBeVisible();
  await expect(page.getByText("للتاريخ.txt")).toBeVisible();
});
