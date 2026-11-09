import { readFileSync } from "node:fs";
import { expect, test } from "./test";
import { installCameraStub, readLastBlobBytes } from "./helpers/camera-stub";
const fixtures = JSON.parse(
  readFileSync(new URL("../.e2e/fixtures.json", import.meta.url), "utf8"),
);
const frames = (fixture: typeof fixtures.plain) =>
  fixture.frames.map((frame: { n: number; dataB64: string }) => ({
    n: frame.n,
    data: new Uint8Array(Buffer.from(frame.dataB64, "base64")),
  }));

test("cold offline Scan loads its worker/WASM and recovers exact bytes after visiting only Home", async ({
  page,
  context,
}) => {
  await page.addInitScript(installCameraStub);
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  const cached = await page.evaluate(async () => {
    const assets = (await (
      await fetch("/asset-manifest.json")
    ).json()) as string[];
    return Promise.all(
      assets.map(async (asset) => ({
        asset,
        cached: !!(await caches.match(asset)),
      })),
    );
  });
  expect(cached.every((entry) => entry.cached)).toBe(true);
  expect(
    cached.filter((entry) => entry.asset.endsWith(".wasm")).length,
  ).toBeGreaterThanOrEqual(4);
  await context.setOffline(true);
  await page.goto("/scan");
  await page.evaluate(
    (value) => window.__qrferrySetFrames(value),
    frames(fixtures.plain),
  );
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "ملفاتك جاهزة" })).toBeVisible(
    { timeout: 60000 },
  );
  expect(Buffer.from((await readLastBlobBytes(page)) ?? [])).toEqual(
    Buffer.from(fixtures.plain.originalBytesB64, "base64"),
  );
  for (const route of ["/bridge", "/privacy", "/history"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    expect((await page.locator("main").innerText()).length).toBeGreaterThan(20);
  }
});

test("Web Share multipart stays in the service worker and is picked up by Send", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/share") &&
      response.request().method() === "POST",
  );
  const next = await page.evaluate(async () => {
    const form = new FormData();
    form.append(
      "files",
      new File(["QRFerry real local share"], "shared-contract.txt", {
        type: "text/plain",
      }),
    );
    return (await fetch("/share", { method: "POST", body: form })).url;
  });
  const response = await responsePromise;
  expect(response.fromServiceWorker()).toBe(true);
  expect(response.status()).toBe(303);
  await page.goto(next);
  await expect(page.locator(".batch-file .fname")).toHaveText(
    "shared-contract.txt",
  );
  await expect(page.locator(".fast-action")).toBeEnabled();
});

test("scanner transfers ownership, allows one frame in flight, and renders telemetry at 5–10Hz", async ({
  page,
}) => {
  await page.addInitScript(installCameraStub);
  await page.addInitScript(() => {
    const state = {
      sent: 0,
      detached: 0,
      inFlight: 0,
      maxInFlight: 0,
      commits: [] as number[],
    };
    (window as unknown as { __workerMetrics: typeof state }).__workerMetrics =
      state;
    const hooked = new WeakSet<Worker>(),
      ids = new WeakMap<Worker, Set<number>>();
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      transfer?: Transferable[] | StructuredSerializeOptions,
    ) {
      const request = message as {
        type?: string;
        id: number;
        pixels?: ArrayBuffer;
      };
      if (request.type === "scan") {
        if (!hooked.has(this)) {
          hooked.add(this);
          ids.set(this, new Set());
          this.addEventListener("message", (event) => {
            if (ids.get(this)?.delete(event.data.id)) state.inFlight--;
          });
        }
        ids.get(this)!.add(request.id);
        state.sent++;
        state.inFlight++;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      }
      Reflect.apply(original, this, [message, transfer]);
      if (request.type === "scan" && request.pixels?.byteLength === 0)
        state.detached++;
    };
    (
      window as unknown as Record<string, unknown>
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberUnmount: () => {},
      onCommitFiberRoot: () => {
        if (document.querySelector(".scanner-page.ws-state-receiving"))
          state.commits.push(performance.now());
      },
    };
  });
  await page.goto("/scan");
  await page.evaluate(
    (value) => window.__qrferrySetFrames(value),
    frames(fixtures.plain).slice(0, 1),
  );
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect(page.locator(".ws-state-receiving")).toBeVisible();
  await page.waitForTimeout(6500);
  const metrics = await page.evaluate(
    () =>
      (
        window as unknown as {
          __workerMetrics: {
            sent: number;
            detached: number;
            maxInFlight: number;
            commits: number[];
          };
        }
      ).__workerMetrics,
  );
  expect(metrics.sent).toBeGreaterThan(15);
  expect(metrics.detached).toBe(metrics.sent);
  expect(metrics.maxInFlight).toBe(1);
  const steady = metrics.commits.filter(
    (time) =>
      time >= metrics.commits[0] + 500 && time <= metrics.commits.at(-1)! - 500,
  );
  console.log(
    "scanner worker metrics",
    JSON.stringify({
      frames: metrics.sent,
      detached: metrics.detached,
      maxInFlight: metrics.maxInFlight,
      commits: steady.length,
      updatesPerSecond: steady.length / ((steady.at(-1)! - steady[0]) / 1000),
      peakOneSecond: Math.max(
        ...steady.map(
          (time) =>
            steady.filter((other) => other >= time && other < time + 1000)
              .length,
        ),
      ),
    }),
  );
  expect(steady.length).toBeGreaterThan(20);
  expect(
    steady.length / ((steady.at(-1)! - steady[0]) / 1000),
  ).toBeGreaterThanOrEqual(5);
  expect(
    Math.max(
      ...steady.map(
        (time) =>
          steady.filter((other) => other >= time && other < time + 1000).length,
      ),
    ),
  ).toBeLessThanOrEqual(10);
  await page
    .getByRole("button", { name: "إيقاف الكاميرا", exact: true })
    .click();
});

test("late camera permission cannot restart capture after navigating away", async ({
  page,
}) => {
  await page.addInitScript(installCameraStub);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      const state = window as unknown as {
        __lateStream: MediaStream;
        __grant: () => void;
      };
      state.__lateStream = stream;
      return new Promise<MediaStream>((resolve) => {
        state.__grant = () => resolve(stream);
      });
    };
  });
  await page.goto("/scan");
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await page.waitForFunction(
    () => !!(window as unknown as { __grant?: () => void }).__grant,
  );
  await page.locator("#nav-send").click();
  await page.evaluate(() =>
    (window as unknown as { __grant: () => void }).__grant(),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __lateStream: MediaStream }).__lateStream
          .getTracks()
          .every((track) => track.readyState === "ended"),
      ),
    )
    .toBe(true);
  await expect(page.locator("#nav-send")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("failed lazy import shows an actionable error instead of an empty root", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "en-US",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  try {
    await page.route("**/assets/scanner-client-*.js", (route) => route.abort());
    await page.goto(test.info().project.use.baseURL + "/scan");
    await expect(
      page.getByRole("heading", { name: "This page could not be displayed" }),
    ).toBeVisible();
    await page.locator(".brand").click();
    await expect(
      page.getByRole("heading", { name: "Send", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("native Glisse touch navigation honors the selected destination without bouncing", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ar-EG",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(test.info().project.use.baseURL + "/");
    const cdp = await context.newCDPSession(page);
    for (const id of [
      "scan",
      "pair",
      "send",
      "pair",
      "scan",
      "send",
      "scan",
      "send",
    ]) {
      const box = await page.locator("#nav-" + id).boundingBox();
      expect(box).not.toBeNull();
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, id: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(page.locator("#nav-" + id)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.waitForTimeout(150);
      expect(new URL(page.url()).pathname).toBe(
        id === "send" ? "/" : id === "pair" ? "/bridge" : "/scan",
      );
    }
  } finally {
    await context.close();
  }
});

test("hydrated route and metadata contract suite", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--test", "tests/rendered-html.test.mjs"],
    {
      env: {
        ...process.env,
        QRFERRY_TEST_ORIGIN: String(test.info().project.use.baseURL),
      },
    },
  );
  console.log(stdout);
});

test("worker persists a paused partial transfer and replays it after reload", async ({
  page,
}) => {
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page.evaluate(
    (value) => window.__qrferrySetFrames(value),
    frames(fixtures.plain).slice(0, 6),
  );
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (
            !(await indexedDB.databases()).some(
              (database) => database.name === "qrferry-resume",
            )
          )
            return 0;
          return new Promise<number>((resolve, reject) => {
            const open = indexedDB.open("qrferry-resume", 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains("sessions")) {
                db.close();
                resolve(0);
                return;
              }
              const request = db
                .transaction("sessions", "readonly")
                .objectStore("sessions")
                .getAll();
              request.onsuccess = () => {
                db.close();
                resolve(
                  Math.max(
                    0,
                    ...request.result.map(
                      (row: { payloads: unknown[] }) => row.payloads.length,
                    ),
                  ),
                );
              };
              request.onerror = () => reject(request.error);
            };
          });
        }),
      { timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(4);
  await page
    .getByRole("button", { name: "إيقاف الكاميرا", exact: true })
    .click();
  await page.reload();
  await page.evaluate(
    (value) => window.__qrferrySetFrames(value),
    frames(fixtures.plain).slice(0, 6),
  );
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect(page.locator(".resume-note")).toBeVisible();
  await page.evaluate(
    (value) => window.__qrferrySetFrames(value),
    frames(fixtures.plain),
  );
  await expect(page.getByRole("heading", { name: "ملفاتك جاهزة" })).toBeVisible(
    { timeout: 60000 },
  );
  expect(Buffer.from((await readLastBlobBytes(page)) ?? [])).toEqual(
    Buffer.from(fixtures.plain.originalBytesB64, "base64"),
  );
});

test("password QR camera round-trip retains the completed encrypted worker session", async ({
  page,
  context,
}) => {
  const sender = await context.newPage();
  await sender.goto("/");
  await sender.getByRole("button", { name: "الخصوصية وخيارات إضافية" }).click();
  await sender.getByRole("switch", { name: /تشفير الملف/ }).click();
  await sender.getByLabel("كلمة المرور", { exact: true }).fill("secret-pass");
  await sender.getByRole("button", { name: "اعرض كلمة المرور كـ QR" }).click();
  await expect(sender.locator(".modal-card canvas:not(.qf-specular-rim)")).toBeVisible();
  const passwordFrame = await sender
    .locator(".modal-card canvas:not(.qf-specular-rim)")
    .evaluate((node: HTMLCanvasElement) => {
      const pixels = node
        .getContext("2d")!
        .getImageData(0, 0, node.width, node.height).data;
      return {
        n: node.width,
        data: Uint8Array.from(
          { length: node.width * node.height },
          (_, index) => (pixels[index * 4] < 128 ? 1 : 0),
        ),
      };
    });
  await page.addInitScript(installCameraStub);
  await page.goto("/scan");
  await page.evaluate(
    (value) => window.__qrferrySetFrames(value),
    frames(fixtures.encrypted),
  );
  await page
    .getByRole("button", { name: "تشغيل الكاميرا", exact: true })
    .click();
  await expect(page.getByText("هذا الملف مشفَّر")).toBeVisible({
    timeout: 60000,
  });
  await page.evaluate(
    (value) => window.__qrferrySetFrames([value]),
    passwordFrame,
  );
  await page
    .getByRole("button", { name: /مسح QR لكلمة المرور|امسح.*كلمة المرور/ })
    .click();
  await expect(page.getByPlaceholder("كلمة المرور")).toHaveValue(
    "secret-pass",
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: "فكّ التشفير", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ملفاتك جاهزة" }),
  ).toBeVisible();
  expect(Buffer.from((await readLastBlobBytes(page)) ?? [])).toEqual(
    Buffer.from(fixtures.encrypted.originalBytesB64, "base64"),
  );
});
