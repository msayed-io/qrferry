import type { NextRequest } from "next/server";

/**
 * نقطة استقبال «المشاركة» (Web Share Target):
 * عندما يشارك المستخدم ملفاً من أي تطبيق أندرويد عبر QRFerry، يرسل
 * المتصفح POST multipart إلى /share. نعيد صفحة مؤقتة تحفظ الملفات في
 * IndexedDB (على الجهاز) ثم تعيد التوجيه إلى صفحة الإرسال التي تلتقطها.
 *
 * القيد: على Vercel (serverless) حد حجم الطلب ~4.5MB؛ فوقه نرشد المستخدم
 * لصفحة الإرسال المباشرة.
 */

export const runtime = "nodejs";

const MAX_SHARE_BYTES = 40 * 1024 * 1024; // حدنا المعقول داخل الصفحة

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildStoreHtml(
  files: Array<{ name: string; mime: string; b64: string }>,
): string {
  const json = JSON.stringify(files);
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>QRFerry</title></head>
<body style="font-family:system-ui;background:#111820;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
  <p id="msg">جارٍ تجهيز الملفات…</p>
<script>
const DB = "qrferry-shared";
const files = ${json};
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("pending")) req.result.createObjectStore("pending", { keyPath: "key" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
(async () => {
  try {
    const db = await openDb();
    const tx = db.transaction("pending", "readwrite");
    const store = tx.objectStore("pending");
    const entries = files.map(f => ({ name: f.name, mime: f.mime, data: base64ToBytes(f.b64).buffer }));
    store.put({ key: "pending", files: entries, at: Date.now() });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    window.location.href = "/?shared=1";
  } catch (e) {
    document.getElementById("msg").textContent = "تعذّر تجهيز الملفات. افتح صفحة الإرسال مباشرة.";
    setTimeout(() => { window.location.href = "/"; }, 2000);
  }
})();
</script>
</body></html>`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const values = formData.getAll("file");
    const files = values
      .map((value) => (value instanceof File ? value : null))
      .filter((file): file is File => file !== null);

    if (files.length === 0) {
      return Response.redirect(new URL("/", request.url), 302);
    }

    const serialized: Array<{ name: string; mime: string; b64: string }> = [];
    let total = 0;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      total += bytes.length;
      serialized.push({
        name: file.name,
        mime: file.type || "application/octet-stream",
        b64: base64FromBytes(bytes),
      });
    }

    if (total > MAX_SHARE_BYTES) {
      // الملف كبير جداً لمسار المشاركة — نوجه لصفحة الإرسال المباشرة
      return new Response(
        `<!doctype html><html lang="ar"><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#111820;color:#fff;text-align:center"><div><p>الملف كبير جداً لمسار المشاركة.</p><a href="/" style="color:#e7ff54">افتح صفحة الإرسال واختر الملف يدوياً</a></div></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    return new Response(buildStoreHtml(serialized), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return Response.redirect(new URL("/", request.url), 302);
  }
}
