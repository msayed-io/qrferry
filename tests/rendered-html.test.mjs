import assert from "node:assert/strict";
import test from "node:test";

// Actual HTTP against the running Next production server, not the removed Worker API.
const origin = process.env.QRFERRY_TEST_ORIGIN || "http://localhost:3000";
async function render(pathname) {
  return fetch(new URL(pathname, origin), {headers:{accept:"text/html"}});
}

for (const [route, title, content] of [
  ["/", "إرسال ملف · QRFerry", "الخصوصية وخيارات إضافية"],
  ["/scan", "مسح نقل · QRFerry", "حالة الاستقبال"],
  ["/bridge", "جسر النقل الذكي · QRFerry", "أنشئ رمز الربط"],
  ["/pc", "جسر الكمبيوتر · QRFerry", "أنشئ رمز الربط"],
  ["/history", "سجل النقل · QRFerry", "الرجوع للرئيسية"],
  ["/offline", "حزمة أوفلاين · QRFerry", "حزمة التطبيق"],
  ["/privacy", "سياسة الخصوصية · QRFerry", "كيف تنتقل الملفات؟"],
]) {
  test(`real HTTP SSR: ${route} retains its route, metadata, identity and functional surface`, async () => {
    const response = await render(route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^text\/html/);
    const html = await response.text();
    assert.ok(html.includes(`<title>${title}</title>`));
    assert.ok(html.includes(content));
    assert.ok(html.includes('class="app-header"'));
    assert.ok(html.includes('class="bottom-nav"'));
    assert.ok(html.includes('dir="rtl"'));
    assert.ok(!html.includes('class="workspace-brand"'));
    assert.ok(!html.includes('id="nav-chat"'), "Chat is not advertised before a real connection");
  });
}

test("real HTTP 404 uses the shared surface without inventing the missing receiver route", async () => {
  const response = await render("/tv");
  assert.equal(response.status, 404);
  assert.ok((await response.text()).includes("هذه الصفحة غير موجودة."));
});
