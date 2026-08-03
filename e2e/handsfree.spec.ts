import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { installCameraStub } from "./helpers/camera-stub";

type Fixture = { frames: Array<{ n: number; dataB64: string }> };

function loadFixture(): Fixture {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".e2e", "fixtures.json");
  const all = JSON.parse(readFileSync(path, "utf8"));
  return all.plain as Fixture;
}

test("hands-free: stability badge shows when the signal is steady", async ({
  page,
}) => {
  const fixture = loadFixture();
  const frames = fixture.frames.map((f) => ({
    n: f.n,
    data: new Uint8Array(Buffer.from(f.dataB64, "base64")),
  }));

  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page.evaluate(
    (fr) =>
      (window as unknown as { __qrferrySetFrames: (f: Array<{ n: number; data: Uint8Array }>) => void })
        .__qrferrySetFrames(fr),
    frames,
  );

  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();

  // الكاميرا المحاكاة مستقرة تماماً → النجاحات متتالية → تظهر شارة الاستقرار
  const badge = page.locator('[data-testid="stability-badge"]');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveClass(/stable/, { timeout: 30_000 });
  await expect(page.getByText("وضع مستقر ✓ يمكنك ترك الموبايل")).toBeVisible();
});

test("hands-free: hands-free tip appears once on first camera start", async ({
  page,
}) => {
  const fixture = loadFixture();
  const frames = fixture.frames.map((f) => ({
    n: f.n,
    data: new Uint8Array(Buffer.from(f.dataB64, "base64")),
  }));

  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page.evaluate(
    (fr) =>
      (window as unknown as { __qrferrySetFrames: (f: Array<{ n: number; data: Uint8Array }>) => void })
        .__qrferrySetFrames(fr),
    frames,
  );

  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();
  await expect(page.getByText(/ثبّت الموبايل على حامل/)).toBeVisible({
    timeout: 20_000,
  });
});
