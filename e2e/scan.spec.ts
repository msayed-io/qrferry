import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "./test";

type SerializedFrame = { n: number; dataB64: string };
type SerializedFixture = {
  frames: SerializedFrame[];
  originalBytesB64: string;
  packetCount: number;
  symbolSize: number;
  encrypted: boolean;
};
type FixtureBundle = { plain: SerializedFixture; encrypted: SerializedFixture };

function loadFixtureBundle(): FixtureBundle {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    ".e2e",
    "fixtures.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as FixtureBundle;
}

function decodeFrames(fixture: SerializedFixture): Array<{ n: number; data: Uint8Array }> {
  return fixture.frames.map((frame) => ({
    n: frame.n,
    data: new Uint8Array(Buffer.from(frame.dataB64, "base64")),
  }));
}

function decodeBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * كاميرا محاكاة: لوحة canvas ترسم إطارات QR (تُحقن من الاختبار) وتُغذّي
 * `getUserMedia` عبر `captureStream` — فيمر البث كاملاً عبر ماسح ZXing
 * الحقيقي داخل المتصفح، تماماً كسيناريو شاشة-إلى-كاميرا فعلي.
 */
function installCameraStub() {
  // تُنفَّذ داخل المتصفح — لا تستخدم أي شيء من بيئة Node.
  const state: { frames: Array<{ n: number; data: Uint8Array }>; index: number; tick: number } =
    { frames: [], index: 0, tick: 0 };
  (window as unknown as { __qrferrySetFrames: (f: Array<{ n: number; data: Uint8Array }>) => void })
    .__qrferrySetFrames = (frames) => {
    state.frames = frames;
    state.index = 0;
    state.tick = 0;
  };
  (window as unknown as { __qrferryBlobs: Blob[] }).__qrferryBlobs = [];

  // لوحة تغذية بنسبة 4:3 (مثل كاميرا هاتف حقيقية) — QR مربع في المنتصف
  // مع هوامش كافية بحيث لا يقطع الـ object-fit ولا قصاصة الماسح الهامش الأبيض.
  const FEED_W = 1280;
  const FEED_H = 720;
  const feed = document.createElement("canvas");
  feed.width = FEED_W;
  feed.height = FEED_H;
  const ctx = feed.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const draw = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, FEED_W, FEED_H);
    const frame = state.frames[state.index];
    if (!frame) return;
    const n = frame.n;
    // يُرسم الكود بما يناسب ارتفاع اللوحة (بهامش أبيض واسع من كل جانب)
    // بحيث يبقى كاملاً داخل قصاصة الماسح المركزية المربعة.
    const cell = Math.floor((FEED_H * 0.82) / (n + 8));
    const side = cell * (n + 8);
    const offsetX = Math.floor((FEED_W - side) / 2);
    const offsetY = Math.floor((FEED_H - side) / 2);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (frame.data[y * n + x]) {
          ctx.fillRect(offsetX + x * cell, offsetY + y * cell, cell, cell);
        }
      }
    }
  };

  // نُثبّت اللوحة في الصفحة لضمان أن captureStream يلتقطها.
  const attach = () => {
    feed.style.cssText = "position:fixed;left:-9999px;top:0;width:0;height:0";
    document.documentElement.appendChild(feed);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }

  window.setInterval(() => {
    state.tick += 1;
    if (state.tick % 3 === 0 && state.frames.length > 0) {
      state.index = (state.index + 1) % state.frames.length;
    }
    draw();
  }, 33);

  navigator.mediaDevices.getUserMedia = async () => feed.captureStream(30);

  // نحتفظ بوظيفة createObjectURL الأصلية: نسجّل البلوب للتحقق ونعيد
  // عنوان blob حقيقياً حتى لا يتعطل أي كود يعتمد على عناوين blob صالحة
  // (مثل العامل الداخلي لمكتبة brotli-wasm).
  const originalCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob: Blob) => {
    const blobs = (window as unknown as { __qrferryBlobs: Blob[] }).__qrferryBlobs;
    blobs.push(blob);
    return originalCreate(blob);
  };
}

async function receivedBlobBytes(page: Page): Promise<number[] | null> {
  return page.evaluate(async () => {
    const blobs = (window as unknown as { __qrferryBlobs: Blob[] }).__qrferryBlobs;
    // بلوب الملف هو آخر ما ينشئه التطبيق (أي بلوبات سابقة تعود لعامل brotli).
    const blob = blobs[blobs.length - 1];
    if (!blob) return null;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
}

const fixtures = loadFixtureBundle();

test("scanner completes a full file transfer through a simulated camera", async ({
  page,
}) => {
  const fixture = fixtures.plain;
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page.evaluate(
    (frames) =>
      (window as unknown as { __qrferrySetFrames: (f: Array<{ n: number; data: Uint8Array }>) => void })
        .__qrferrySetFrames(frames),
    decodeFrames(fixture),
  );

  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();
  await expect(page.getByText("تم استرداد الملف.")).toBeVisible({
    timeout: 120_000,
  });

  const received = await receivedBlobBytes(page);
  expect(received).not.toBeNull();
  expect(Buffer.from(received as number[])).toEqual(
    Buffer.from(decodeBytes(fixture.originalBytesB64)),
  );
});

test("encrypted transfer requires the password to decrypt", async ({ page }) => {
  const fixture = fixtures.encrypted;
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page.evaluate(
    (frames) =>
      (window as unknown as { __qrferrySetFrames: (f: Array<{ n: number; data: Uint8Array }>) => void })
        .__qrferrySetFrames(frames),
    decodeFrames(fixture),
  );

  await page.getByRole("button", { name: "تشغيل الكاميرا" }).click();
  await expect(page.getByText("هذا الملف مشفَّر")).toBeVisible({
    timeout: 120_000,
  });

  const passwordInput = page.getByPlaceholder("كلمة المرور");
  await passwordInput.fill("wrong-pass");
  await page.getByRole("button", { name: "فكّ التشفير" }).click();
  await expect(page.getByText(/كلمة المرور غير صحيحة/)).toBeVisible();

  await passwordInput.fill("secret-pass");
  await page.getByRole("button", { name: "فكّ التشفير" }).click();
  await expect(page.getByText("تم استرداد الملف.")).toBeVisible({
    timeout: 60_000,
  });

  const received = await receivedBlobBytes(page);
  expect(received).not.toBeNull();
  expect(Buffer.from(received as number[])).toEqual(
    Buffer.from(decodeBytes(fixture.originalBytesB64)),
  );
});
