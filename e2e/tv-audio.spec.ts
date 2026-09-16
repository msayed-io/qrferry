import { expect, test, type BrowserContext, type Page } from "./test";
import { installCameraStub } from "./helpers/camera-stub";

// Actual decodable PCM audio, not random bytes labelled as audio.
function wav() {
  const samples = 24000;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(
      Math.round(1000 * Math.sin((2 * Math.PI * 440 * i) / 8000)),
      44 + i * 2,
    );
  return b;
}
async function transfer(
  context: BrowserContext,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  tv?: Page,
) {
  await context.addInitScript(() => {
    localStorage.setItem(
      "qrferry-peer-host",
      JSON.stringify({
        host: "localhost",
        port: 9000,
        path: "/",
        secure: false,
      }),
    );
    localStorage.setItem("qrferry-tour-seen-v1", "1");
    (window as Window & { __qrferryTestMode?: boolean }).__qrferryTestMode =
      true;
  });
  tv ??= await context.newPage();
  await tv.goto("/tv");
  await tv.waitForFunction(() => !!window.__qrferryTvModules);
  const phone = await context.newPage();
  await phone.addInitScript(installCameraStub);
  await phone.goto("/");
  await phone.setInputFiles("input[type=file]", files);
  const modules = await tv.evaluate(() => window.__qrferryTvModules!);
  await phone.evaluate(
    (fr) =>
      window.__qrferrySetFrames([{ n: fr.n, data: new Uint8Array(fr.data) }]),
    modules,
  );
  await phone.locator(".fast-action").click();
  await phone.getByRole("button", { name: "ابدأ المسح" }).click();
  await expect(phone.getByText(/اكتمل الإرسال/)).toBeVisible({
    timeout: 60000,
  });
  return tv;
}

test("TV plays real WAV with generic MIME and downloads exact received bytes", async ({
  context,
}) => {
  const bytes = wav();
  const tv = await transfer(context, [
    { name: "تسجيل.wav", mimeType: "application/octet-stream", buffer: bytes },
  ]);
  const audio = tv.locator("audio");
  await expect(audio).toBeVisible({ timeout: 5000 });
  await tv.getByRole("button", { name: "تشغيل", exact: true }).click();
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0);
  const actual = await audio.evaluate(async (a: HTMLAudioElement) =>
    Array.from(new Uint8Array(await (await fetch(a.src)).arrayBuffer())),
  );
  expect(Buffer.from(actual)).toEqual(bytes);
  await tv.evaluate(() =>
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    }),
  );
  const download = tv.waitForEvent("download", { timeout: 10000 });
  await tv.getByRole("button", { name: /حفظ الملف/ }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe("تسجيل.wav");
  const fs = await import("node:fs/promises");
  expect(await fs.readFile((await result.path())!)).toEqual(bytes);
});

test("TV unpacks a bundle and exposes playable audio, not a QFPA blob", async ({
  context,
}) => {
  const bytes = wav();
  const tv = await transfer(context, [
    { name: "voice.wav", mimeType: "application/octet-stream", buffer: bytes },
    { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
  ]);
  await expect(tv.locator("audio")).toBeVisible({ timeout: 5000 });
  await expect(tv.locator(".tv-file-name")).toHaveText("voice.wav");
  await expect(tv.getByRole("button", { name: /note.txt/ })).toBeVisible();
});

test("TV exposes playback failures instead of swallowing play rejection", async ({
  context,
}) => {
  const tv = await transfer(context, [
    { name: "voice.wav", mimeType: "audio/wav", buffer: wav() },
  ]);
  await tv.evaluate(() => {
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(
        new DOMException("Test decoder failure", "NotSupportedError"),
      );
  });
  await tv.getByRole("button", { name: "تشغيل", exact: true }).click();
  await expect(tv.locator(".tv-playback-error")).toContainText(
    /NotSupportedError/,
    { timeout: 5000 },
  );
});

test("TV retains exact playable bytes after reload and reopening the library", async ({
  context,
}) => {
  const bytes = wav();
  const tv = await transfer(context, [
    {
      name: "persist.wav",
      mimeType: "application/octet-stream",
      buffer: bytes,
    },
  ]);
  await expect(tv.locator(".tv-library-status")).toContainText("حُفظ داخل");
  await tv.reload();
  await tv.getByRole("button", { name: /الملفات المستلمة/ }).click();
  await tv.locator(".tv-library-item", { hasText: "persist.wav" }).click();
  const audio = tv.locator("audio");
  await expect(audio).toBeVisible();
  const actual = await audio.evaluate(async (a: HTMLAudioElement) =>
    Array.from(new Uint8Array(await (await fetch(a.src)).arrayBuffer())),
  );
  expect(Buffer.from(actual)).toEqual(bytes);
  await tv.getByRole("button", { name: "تشغيل", exact: true }).click();
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0);
});

test("Cancelling the save picker never triggers a fallback download", async ({
  context,
}) => {
  const tv = await transfer(context, [
    { name: "cancel.wav", mimeType: "audio/wav", buffer: wav() },
  ]);
  await tv.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Cancelled", "AbortError")),
    });
  });
  let downloads = 0;
  tv.on("download", () => downloads++);
  await tv.getByRole("button", { name: /حفظ الملف/ }).click();
  await expect(tv.locator(".tv-save-status")).toHaveText("أُلغيت عملية الحفظ.");
  await tv.waitForTimeout(200);
  expect(downloads).toBe(0);
});

test("Storage transaction abort is visible and does not prevent actual audio playback", async ({
  context,
}) => {
  await context.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const result = put.apply(this, args);
      if (
        this.transaction.db.name === "qrferry-received-files" &&
        this.name === "files"
      ) {
        // Request succeeds, but the transaction aborts before durable commit.
        result.addEventListener("success", () => this.transaction.abort());
      }
      return result;
    };
  });
  const tv = await transfer(context, [
    { name: "quota.wav", mimeType: "audio/wav", buffer: wav() },
  ]);
  await expect(tv.locator(".tv-storage-error")).toContainText(
    "الحفظ داخل مكتبة المتصفح فشل",
  );
  await expect(tv.locator(".tv-library-status")).toContainText("فشل");
  const audio = tv.locator("audio");
  await expect(audio).toBeVisible();
  await tv.getByRole("button", { name: "تشغيل", exact: true }).click();
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0);
});

test("Legacy v1 library migrates without dropping its file bytes", async ({
  context,
}) => {
  const tv = await context.newPage();
  await tv.goto("/offline");
  const bytes = wav();
  await tv.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("qrferry-received-files", 1);
      r.onupgradeneeded = () =>
        r.result
          .createObjectStore("files", { keyPath: "id" })
          .createIndex("receivedAt", "receivedAt");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.objectStore("files").put({
        id: "legacy",
        name: "legacy.wav",
        mime: "application/octet-stream",
        size: data.length,
        data: new Uint8Array(data).buffer,
        receivedAt: Date.now(),
      });
    });
    db.close();
  }, Array.from(bytes));
  await tv.goto("/tv");
  await tv.getByRole("button", { name: /الملفات المستلمة/ }).click();
  await tv.locator(".tv-library-item", { hasText: "legacy.wav" }).click();
  await expect(tv.locator("audio")).toBeVisible();
  const actual = await tv
    .locator("audio")
    .evaluate(async (a: HTMLAudioElement) =>
      Array.from(new Uint8Array(await (await fetch(a.src)).arrayBuffer())),
    );
  expect(Buffer.from(actual)).toEqual(bytes);
});

test("Native save picker receives exact bytes and the original extension, and reports success after close", async ({
  context,
}) => {
  const bytes = wav();
  const tv = await transfer(context, [
    { name: "real.wav", mimeType: "audio/wav", buffer: bytes },
  ]);
  await tv.evaluate(() => {
    const state = { name: "", data: [] as number[], closed: false };
    (window as Window & { __saveProof?: typeof state }).__saveProof = state;
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async (options: { suggestedName: string }) => {
        state.name = options.suggestedName;
        return {
          createWritable: async () => ({
            write: async (blob: Blob) => {
              state.data = Array.from(new Uint8Array(await blob.arrayBuffer()));
            },
            close: async () => {
              state.closed = true;
            },
          }),
        };
      },
    });
  });
  await tv.getByRole("button", { name: /حفظ الملف/ }).click();
  await expect(tv.locator(".tv-save-status")).toHaveText(
    "تم الحفظ في المكان الذي اخترته.",
  );
  const proof = await tv.evaluate(
    () =>
      (
        window as Window & {
          __saveProof?: { name: string; data: number[]; closed: boolean };
        }
      ).__saveProof!,
  );
  expect(proof.closed).toBe(true);
  expect(proof.name).toBe("real.wav");
  expect(Buffer.from(proof.data)).toEqual(bytes);
});

test("Blob URLs are released when selecting another received file", async ({
  context,
}) => {
  const tv = await transfer(context, [
    { name: "one.wav", mimeType: "audio/wav", buffer: wav() },
    { name: "two.wav", mimeType: "audio/wav", buffer: wav() },
  ]);
  const first = await tv.locator("audio").getAttribute("src");
  await tv.getByRole("button", { name: "two.wav", exact: true }).click();
  await expect(tv.locator("audio")).not.toHaveAttribute("src", first!);
  const oldUsable = await tv.evaluate(async (url) => {
    try {
      return (await fetch(url!)).ok;
    } catch {
      return false;
    }
  }, first);
  expect(oldUsable).toBe(false);
});

test("Pairing instructions point to the current installation, never a hard-coded old deployment", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles("input[type=file]", {
    name: "local.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await page.locator(".fast-action").click();
  await expect(page.locator(".fast-url")).toHaveText(
    new URL("/tv", page.url()).href,
  );
});

for (const failure of ["write", "close"] as const) {
  test(`A native save ${failure} failure is visible, aborts the write and never claims success`, async ({
    context,
  }) => {
    const tv = await transfer(context, [
      { name: "failed.wav", mimeType: "audio/wav", buffer: wav() },
    ]);
    await tv.evaluate((stage) => {
      (window as Window & { __writeAborted?: boolean }).__writeAborted = false;
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: async () => ({
          createWritable: async () => ({
            write: async () => {
              if (stage === "write")
                throw new DOMException(
                  "test write failure",
                  "QuotaExceededError",
                );
            },
            close: async () => {
              if (stage === "close")
                throw new DOMException("test close failure", "NotAllowedError");
            },
            abort: async () => {
              (window as Window & { __writeAborted?: boolean }).__writeAborted =
                true;
            },
          }),
        }),
      });
    }, failure);
    let downloads = 0;
    tv.on("download", () => downloads++);
    await tv.getByRole("button", { name: /حفظ الملف/ }).click();
    await expect(tv.locator(".tv-save-status")).toContainText(
      `فشل الحفظ: test ${failure} failure`,
    );
    expect(
      await tv.evaluate(
        () => (window as Window & { __writeAborted?: boolean }).__writeAborted,
      ),
    ).toBe(true);
    expect(downloads).toBe(0);
  });
}
