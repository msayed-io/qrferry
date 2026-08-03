/**
 * QRFerry Service Worker
 * - يخزّن مسبقاً قشرة التطبيق وأيقونات PWA.
 * - يسترجع /asset-manifest.json (يُولَّد وقت البناء) فيخزّن كل الأصول
 *   المجزّأة: JavaScript و CSS و WebAssembly (RaptorQ / fast_qr / ZXing)
 *   والخطوط، فتشتغل التطبيقات بالكامل دون اتصال بعد أول زيارة.
 * - إن لم تتوفر القائمة (بيئة تطوير محلية)، يفحص صفحات HTML ويخزّن
 *   روابط /assets/ التي يجدها، مع اعتماد التخزين وقت التشغيل للباقي.
 */
const CACHE = "qrferry-shell-v5";
const SHELL = [
  "/",
  "/scan",
  "/tv",
  "/history",
  "/offline",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

async function collectHtmlAssets() {
  const urls = new Set();
  for (const page of ["/", "/scan"]) {
    try {
      const response = await fetch(page, { headers: { accept: "text/html" } });
      if (!response.ok) continue;
      const html = await response.text();
      const pattern = /(?:src|href)="(\/assets\/[^"]+)"/g;
      let match;
      while ((match = pattern.exec(html)) !== null) urls.add(match[1]);
    } catch {
      // تجاهل الصفحة غير المتاحة.
    }
  }
  return [...urls];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      let assets = [];
      try {
        const response = await fetch("/asset-manifest.json");
        if (response.ok) {
          const list = await response.json();
          if (Array.isArray(list)) assets = list;
        }
      } catch {
        // غير متاحة محلياً.
      }
      if (assets.length === 0) {
        assets = await collectHtmlAssets();
      }
      if (assets.length > 0) {
        await cache.addAll(assets);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // لا نتعامل مع الطلبات المتقاطعة الأصل.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const copy = response.clone();
          cache.put(request, copy).catch(() => {});
        }
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return (await cache.match("/scan")) || Response.error();
        }
        return Response.error();
      }
    })(),
  );
});
