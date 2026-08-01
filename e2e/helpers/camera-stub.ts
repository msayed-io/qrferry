/**
 * كاميرا محاكاة تُحقن في الصفحة: لوحة canvas بنسبة 4:3 ترسم إطارات QR
 * (تُضبط من الاختبار) وتُغذّي `getUserMedia` عبر `captureStream`.
 * تُستدعى عبر `page.addInitScript(installCameraStub)`.
 */
export function installCameraStub() {
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

  const attach = () => {
    feed.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1";
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

/** يقرأ آخر بلوب أنشأه التطبيق (بلوب الملف المُستلم). */
export function readLastBlobBytes(page: {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
}): Promise<number[] | null> {
  return page.evaluate(async () => {
    const blobs = (window as unknown as { __qrferryBlobs: Blob[] }).__qrferryBlobs;
    const blob = blobs[blobs.length - 1];
    if (!blob) return null;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
}
