import { expect, test, type BrowserContext, type Page } from "./test";
import { installCameraStub } from "./helpers/camera-stub";

const PEER_HOST = { host: "localhost", port: 9000, path: "/", secure: false };

async function useLocalPeerServer(context: BrowserContext): Promise<void> {
  await context.addInitScript((peerHost) => {
    localStorage.setItem("qrferry-peer-host", JSON.stringify(peerHost));
  }, PEER_HOST);
}

/** ينتظر رمز الربط المعروض على الكمبيوتر ويعيد رابطه الكامل. */
async function waitForPairingUrl(laptop: Page): Promise<string> {
  await expect
    .poll(() => laptop.evaluate(() => window.__qrferryBridgeModules?.n ?? null), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const hook = await laptop.evaluate(() => window.__qrferryBridge ?? null);
  expect(hook?.url).toMatch(/\/pc#QFB1\./);
  return hook?.url as string;
}

/** يغذّي كاميرا الهاتف المحاكاة بمصفوفة QR المعروضة على الكمبيوتر. */
async function pointPhoneAtLaptopQr(phone: Page, laptop: Page): Promise<void> {
  const modules = await laptop.evaluate(() => window.__qrferryBridgeModules ?? null);
  expect(modules).not.toBeNull();
  await phone.evaluate(
    (frame) =>
      (window as unknown as { __qrferrySetFrames: (f: unknown[]) => void }).__qrferrySetFrames([
        { n: frame.n, data: new Uint8Array(frame.data) },
      ]),
    modules as { n: number; data: number[] },
  );
}

async function expectConnected(page: Page): Promise<void> {
  await expect(page.locator(".bridge-status")).toContainText("متصل", { timeout: 60_000 });
}

function patternedBytes(length: number, seed: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff));
}

test("bridge: laptop shows a QR and the phone pairs by scanning it, then both ways chat and files", async ({
  context,
}) => {
  await useLocalPeerServer(context);

  const laptop = await context.newPage();
  await laptop.goto("/pc");
  await laptop.getByRole("button", { name: "أنشئ رمز الربط" }).click();
  await waitForPairingUrl(laptop);
  await expect(laptop.locator(".bridge-qr-canvas")).toBeVisible();

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.addInitScript(installCameraStub);
  await phone.goto("/pc");
  // الهاتف لا يُحجب بأي رسالة "للشاشات الكبيرة" على هذه الصفحة.
  await expect(phone.getByText("الشاشات الكبيرة")).toHaveCount(0);
  await expect(phone.locator("h1")).toHaveText("اربط هاتفك بالكمبيوتر");

  await phone.getByRole("button", { name: "افتح الكاميرا للمسح" }).click();
  await pointPhoneAtLaptopQr(phone, laptop);

  await expectConnected(laptop);
  await expectConnected(phone);

  // الشات في الاتجاهين.
  await phone.getByLabel("اكتب رسالة").fill("مرحباً من الهاتف");
  await phone.getByRole("button", { name: "إرسال", exact: true }).click();
  await expect(laptop.locator(".bridge-bubble.in")).toContainText("مرحباً من الهاتف");
  await expect(phone.locator(".bridge-bubble.out")).toContainText("مرحباً من الهاتف");

  await laptop.getByLabel("اكتب رسالة").fill("أهلاً من الكمبيوتر");
  await laptop.getByRole("button", { name: "إرسال", exact: true }).click();
  await expect(phone.locator(".bridge-bubble.in")).toContainText("أهلاً من الكمبيوتر");

  // ملف من الهاتف إلى الكمبيوتر (أكثر من قطعة واحدة) والتحقق بايت بايت.
  const phoneFile = patternedBytes(300_000, 7);
  await phone.locator(".bridge-composer input[type=file]").setInputFiles({
    name: "من-الهاتف.bin",
    mimeType: "application/octet-stream",
    buffer: phoneFile,
  });
  await expect
    .poll(() => laptop.evaluate(() => window.__qrferryBridge?.received.length ?? 0), { timeout: 90_000 })
    .toBe(1);
  const onLaptop = await laptop.evaluate(() => window.__qrferryBridge?.received[0] ?? null);
  expect(onLaptop?.name).toBe("من-الهاتف.bin");
  expect(Buffer.from(onLaptop?.bytes ?? [])).toEqual(phoneFile);

  // ملف من الكمبيوتر إلى الهاتف.
  const laptopFile = patternedBytes(120_000, 99);
  await laptop.locator(".bridge-composer input[type=file]").setInputFiles({
    name: "من-الكمبيوتر.txt",
    mimeType: "text/plain",
    buffer: laptopFile,
  });
  await expect
    .poll(() => phone.evaluate(() => window.__qrferryBridge?.received.length ?? 0), { timeout: 90_000 })
    .toBe(1);
  const onPhone = await phone.evaluate(() => window.__qrferryBridge?.received[0] ?? null);
  expect(onPhone?.name).toBe("من-الكمبيوتر.txt");
  expect(Buffer.from(onPhone?.bytes ?? [])).toEqual(laptopFile);
  await expect(phone.locator(".bridge-file.in")).toContainText("من-الكمبيوتر.txt");
});

test("bridge: pasted link pairs the phone without the camera", async ({ context }) => {
  await useLocalPeerServer(context);

  const laptop = await context.newPage();
  await laptop.goto("/pc");
  await laptop.getByRole("button", { name: "أنشئ رمز الربط" }).click();
  const url = await waitForPairingUrl(laptop);

  const phone = await context.newPage();
  await phone.goto("/pc");
  await phone.getByLabel("أو الصق الرابط الذي يعرضه الكمبيوتر").fill("ليس رابطاً");
  await phone.getByRole("button", { name: "اتصل", exact: true }).click();
  await expect(phone.getByRole("alert")).toContainText("الرابط أو الرمز غير صالح");

  await phone.getByLabel("أو الصق الرابط الذي يعرضه الكمبيوتر").fill(url);
  await phone.getByRole("button", { name: "اتصل", exact: true }).click();
  await expectConnected(phone);
  await expectConnected(laptop);
});

test("bridge: opening the pairing URL auto-joins and cleans the address to /pc", async ({
  context,
}) => {
  await useLocalPeerServer(context);

  const laptop = await context.newPage();
  await laptop.goto("/pc");
  await laptop.getByRole("button", { name: "أنشئ رمز الربط" }).click();
  const url = await waitForPairingUrl(laptop);

  const phone = await context.newPage();
  await phone.goto(url);
  await expectConnected(phone);
  await expectConnected(laptop);
  await expect
    .poll(() => new URL(phone.url()).pathname, { timeout: 10_000 })
    .toBe("/pc");
  expect(new URL(phone.url()).hash).toBe("");
});

test("bridge: a laptop that stops listening lets the phone see the disconnect", async ({
  context,
}) => {
  await useLocalPeerServer(context);

  const laptop = await context.newPage();
  await laptop.goto("/pc");
  await laptop.getByRole("button", { name: "أنشئ رمز الربط" }).click();
  const url = await waitForPairingUrl(laptop);

  const phone = await context.newPage();
  await phone.goto(url);
  await expectConnected(phone);

  await laptop.getByRole("button", { name: "قطع الاتصال" }).click();
  await expect(laptop.locator(".bridge-session")).toHaveCount(0);

  // الهاتف يعود إلى الشاشة الرئيسية، ويبقى الخطأ ظاهراً بدل أن يتعطل.
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("اربط هاتفك بالكمبيوتر", {
    timeout: 30_000,
  });
  await expect(phone.locator(".bridge-status")).toHaveCount(0);
});
