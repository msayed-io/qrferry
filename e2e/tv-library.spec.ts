import { expect, test } from "./test";
import { installCameraStub } from "./helpers/camera-stub";

const PEER_HOST = { host: "localhost", port: 9000, path: "/", secure: false };

async function sendFileToTv(
  context: import("@playwright/test").BrowserContext,
  fileName: string,
  buffer: Buffer,
) {
  await context.addInitScript((h) => {
    window.__qrferryTestMode = true;
    localStorage.setItem("qrferry-peer-host", JSON.stringify(h));
  }, PEER_HOST);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("qrferry-tour-seen-v1", "1");
    } catch {
      /* ignore */
    }
  });

  const tvPage = await context.newPage();
  await tvPage.goto("/tv");
  await tvPage.waitForFunction(() => !!window.__qrferryTvInfo, null, {
    timeout: 20_000,
  });

  const phonePage = await context.newPage();
  await phonePage.addInitScript(installCameraStub);
  await phonePage.goto("/");
  await phonePage.setInputFiles('input[type="file"]', {
    name: fileName,
    mimeType: "text/plain",
    buffer,
  });
  const modules = await tvPage.evaluate(() => window.__qrferryTvModules!);
  await phonePage.evaluate(
    (fr) =>
      window.__qrferrySetFrames([{ n: fr.n, data: new Uint8Array(fr.data) }]),
    modules,
  );
  await phonePage.locator(".fast-action").click();
  await phonePage.getByRole("button", { name: "ابدأ المسح" }).click();
  await expect(phonePage.getByText(/اكتمل الإرسال/)).toBeVisible({
    timeout: 60_000,
  });
  return { tvPage, phonePage };
}

test("received file is auto-saved and appears in the library (survives reload)", async ({
  context,
}) => {
  const buffer = Buffer.from("ملف تلقائي ".repeat(3000));
  const { tvPage } = await sendFileToTv(context, "تلقائي.txt", buffer);

  // اكتمال الاستقبال
  await expect
    .poll(
      () => tvPage.evaluate(() => window.__qrferryTvReceived?.size ?? null),
      { timeout: 30_000 },
    )
    .toBe(buffer.length);

  // الحفظ التلقائي: الملف يظهر في المكتبة
  await tvPage.getByRole("button", { name: /الملفات المستلمة/ }).click();
  await expect(
    tvPage.locator(".tv-library-name", { hasText: "تلقائي.txt" }),
  ).toBeVisible({ timeout: 10_000 });

  // إعادة تحميل الصفحة → الملف ما زال موجوداً (مخزّن في IndexedDB، لا يتبخر)
  await tvPage.reload();
  await tvPage.waitForFunction(() => !!window.__qrferryTvInfo, null, {
    timeout: 20_000,
  });
  await tvPage.getByRole("button", { name: /الملفات المستلمة/ }).click();
  await expect(
    tvPage.locator(".tv-library-name", { hasText: "تلقائي.txt" }),
  ).toBeVisible({ timeout: 10_000 });

  // فتحه من المكتبة → يظهر مجدداً
  await tvPage.locator(".tv-library-item", { hasText: "تلقائي.txt" }).click();
  await expect(tvPage.locator(".tv-file-name")).toHaveText("تلقائي.txt");
});

test("multiple files accumulate in the library", async ({ context }) => {
  const first = await sendFileToTv(
    context,
    "أول.txt",
    Buffer.from("أول ".repeat(2000)),
  );
  await sendFileToTv(context, "ثاني.txt", Buffer.from("ثاني ".repeat(2000)));
  await expect
    .poll(async () =>
      first.tvPage.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("qrferry-received-files");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const count = await new Promise<number>((resolve, reject) => {
          const r = db.transaction("metadata").objectStore("metadata").count();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        return count;
      }),
    )
    .toBe(2);
  await first.tvPage.getByRole("button", { name: /الملفات المستلمة/ }).click();
  await expect(
    first.tvPage.locator(".tv-library-name", { hasText: "أول.txt" }),
  ).toBeVisible();
  await expect(
    first.tvPage.locator(".tv-library-name", { hasText: "ثاني.txt" }),
  ).toBeVisible();
});
