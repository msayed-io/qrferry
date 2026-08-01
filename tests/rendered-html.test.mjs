import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the sender product surface (Arabic RTL)", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>إرسال ملف · QRFerry<\/title>/i);
  assert.match(html, /انقل ملفاً/);
  assert.match(html, /اختر ملفاً/);
  assert.match(html, /ابدأ بثّ QR/);
  assert.match(html, /Brotli-11 \+ gzip-9/);
  assert.match(html, /RaptorQ FEC/);
  assert.match(html, /المزدوجة تتبادل مسارين ثابتين/i);
  assert.match(html, /Turbo 30/);
  assert.match(html, /1 Mbps/);
  assert.match(html, /تشفير الملف بكلمة مرور/);
  assert.doesNotMatch(html, /codex-preview|loading skeleton/i);
});

test("server-renders the mobile scanner surface (Arabic RTL)", async () => {
  const response = await render("/scan");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>مسح نقل · QRFerry<\/title>/i);
  assert.match(html, /وجّه\. ثبّت\. استقبل\./);
  assert.match(html, /تشغيل الكاميرا/);
  assert.match(html, /تقدّم استرداد الملف/);
  assert.match(html, /معدل الملف الفعلي/);
  assert.match(html, /مسار مزدوج/);
  assert.match(html, /فك p50 \/ p95/i);
  assert.match(html, /مستقبل RaptorQ للموبايل|أي مسار ثابت يقدّم الملف/);
});
