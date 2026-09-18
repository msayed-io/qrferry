import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${pathname}`,
  );
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
  assert.match(html, /أرسل ملفاتك/);
  assert.match(html, /ملفات الإرسال/);
  assert.match(html, /ابدأ بثّ QR/);
  assert.match(html, /الخصوصية وخيارات إضافية/);
  assert.match(html, /QRFERRY-UI-7/);
  assert.match(html, /إعدادات بثّ QR/);
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
  assert.match(html, /استقبل ملفاتك/);
  assert.match(html, /تشغيل الكاميرا/);
  assert.match(html, /تقدّم استرداد الملف/);
  assert.match(html, /حالة الاستقبال/);
  assert.match(html, /مسار مزدوج/);
  assert.match(html, /فك p50 \/ p95/i);
  assert.match(html, /التفاصيل التقنية/);
});

for (const [path, title] of [
  ["/history", "سجل النقل المحلي"],
  ["/offline", "حزمة النشر الأوفلاين"],
  ["/privacy", "سياسة الخصوصية"],
]) {
  test(`server-renders ${path} with shared identity and an explicit home link`, async () => {
    const response = await render(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /QRFERRY-UI-7/);
    assert.match(html, /class="support-page"/);
    assert.match(html, /الرجوع للرئيسية/);
    assert.ok(html.includes(title));
  });
}
