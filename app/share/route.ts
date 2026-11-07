import type { NextRequest } from "next/server";
import type { Lang } from "@/lib/i18n";
import { requestLanguage } from "../device-language";

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
  lang: Lang,
): string {
  const json = JSON.stringify(files);
  return `<!doctype html>
<html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>QRFerry</title><link rel="stylesheet" href="/design.css"></head>
<body>
  <main class="wrap card"><p id="msg" role="status">${lang === "ar" ? "جارٍ تجهيز الملفات…" : "Preparing files…"}</p></main>
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
    document.getElementById("msg").textContent = ${JSON.stringify(lang === "ar" ? "تعذّر تجهيز الملفات. افتح صفحة الإرسال مباشرة." : "Could not prepare files. Open the send page directly.")};
    setTimeout(() => { window.location.href = "/"; }, 2000);
  }
})();
</script>
</body></html>`;
}

export async function POST(request: NextRequest) {
  const lang = requestLanguage(request.headers.get("accept-language"));
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
        `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><link rel="stylesheet" href="/design.css"><title>QRFerry</title></head><body><main class="wrap card"><p role="alert">${lang === "ar" ? "الملف كبير جداً لمسار المشاركة." : "This file is too large for the share route."}</p><a href="/" class="glass tinted cap" style="margin-top:16px;--o:9.94px;text-decoration:none">${lang === "ar" ? "افتح صفحة الإرسال واختر الملف يدوياً" : "Open the send page and choose the file manually"}</a></main></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    return new Response(buildStoreHtml(serialized, lang), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return Response.redirect(new URL("/", request.url), 302);
  }
}
