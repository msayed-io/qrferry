/**
 * حزمة النشر الأوفلاين: يجمع الموقع الحي (الصفحات + كل الأصول المجزّأة
 * + مكتبات WASM + الخطوط + الأيقونات) في ملف ZIP واحد يُنقل إلى أي شبكة
 * معزولة عن الإنترنت ويُشغَّل محلياً.
 */

import { zipSync, strToU8 } from "fflate";

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: "text/html" } });
  if (!response.ok) throw new Error(`تعذّر جلب ${url}: ${response.status}`);
  return response.text();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`تعذّر جلب ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function extractAssetUrls(html: string): string[] {
  const urls = new Set<string>();
  const pattern = /(?:src|href)="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const value = match[1];
    if (value.startsWith("/_next/") || value.startsWith("/assets/")) {
      urls.add(value);
    } else if (value.startsWith("/") && !value.startsWith("//")) {
      urls.add(value);
    }
  }
  // تجاهل صفحات التنقل نفسها (نعالجها منفصلة)
  urls.delete("/");
  urls.delete("/scan");
  return [...urls];
}

const STATIC_FILES = [
  "/manifest.webmanifest",
  "/favicon.svg",
  "/sw.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/og.png",
];

export async function buildOfflinePackage(): Promise<{
  blob: Blob;
  fileName: string;
  fileCount: number;
}> {
  const origin = window.location.origin;
  const files: Record<string, Uint8Array> = {};

  // الصفحات
  files["index.html"] = strToU8(await fetchText("/"));
  files["scan.html"] = strToU8(await fetchText("/scan"));
  files["privacy.html"] = strToU8(await fetchText("/privacy"));

  // الأصول المذكورة في الصفحات
  const htmlPages = [
    files["index.html"],
    files["scan.html"],
    files["privacy.html"],
  ];
  const assetUrls = new Set<string>();
  void origin;
  for (const html of htmlPages) {
    for (const url of extractAssetUrls(new TextDecoder().decode(html))) {
      assetUrls.add(url);
    }
  }

  // الملفات الثابتة
  for (const path of STATIC_FILES) {
    try {
      files[path.slice(1)] = await fetchBytes(path);
    } catch {
      // بعض الملفات قد لا تكون موجودة — نتجاهلها.
    }
  }

  // الأصول المجزّأة (مع استخراج مراجع WASM من الـ chunks)
  for (const url of assetUrls) {
    try {
      const bytes = await fetchBytes(url);
      files[url.replace(/^\//, "")] = bytes;
      // نفحص الـ JS chunks عن مراجع wasm
      if (url.endsWith(".js")) {
        const text = new TextDecoder().decode(bytes);
        const wasmPattern = /static\/media\/[A-Za-z0-9_.-]+\.wasm/g;
        let wasmMatch: RegExpExecArray | null;
        while ((wasmMatch = wasmPattern.exec(text)) !== null) {
          const wasmPath = `_next/${wasmMatch[0]}`;
          if (!files[wasmPath]) {
            try {
              files[wasmPath] = await fetchBytes(`/${wasmPath}`);
            } catch {
              // تجاهل
            }
          }
        }
      }
    } catch {
      // نتجاهل الأصول الفاشلة (قد تكون optional chunks)
    }
  }

  // خادم التسيير المدمج (نقل سريع داخل الشبكة المعزولة)
  try {
    const serverSrc = await (await fetch("/offline-server.mjs")).text();
    files["server/offline-server.mjs"] = strToU8(serverSrc);
    files["server/package.json"] = strToU8(
      JSON.stringify(
        {
          name: "qrferry-offline-server",
          private: true,
          type: "module",
          dependencies: { express: "^4.19.2", peer: "^1.0.2" },
        },
        null,
        2,
      ) + "\n",
    );
  } catch {
    // الخادم غير متاح (بيئة تطوير) — نتجاهل
  }

  // README صغير للاستخدام
  files["READ-ME.txt"] = strToU8(
    "QRFerry — حزمة النشر الأوفلاين\n" +
      "============================\n" +
      "الطريقة 1 (سريعة — نقل محلي WebRTC):\n" +
      "  cd server && npm install && node offline-server.mjs 9000 ..\n" +
      "  افتح http://localhost:9000 على التلفزيون/الجهاز المستضيف،\n" +
      "  وحدد خادم التسيير: ws://<عنوان-هذا-الجهاز>:9000/peerjs\n" +
      "  على شاشة /tv (قسم «خادم التسيير المخصص»).\n" +
      "الطريقة 2 (بصرية QR فقط — بدون شبكة محلية):\n" +
      "  شغّل أي خادم ويب بسيط من داخل المجلد، مثل:\n" +
      "  python3 -m http.server 8080 ثم افتح http://localhost:8080\n" +
      "ملاحظة: الكاميرا تحتاج HTTPS أو localhost لتعمل.\n",
  );

  const zipData = zipSync(files, { level: 6 });
  const blob = new Blob([zipData], { type: "application/zip" });
  const date = new Date().toISOString().slice(0, 10);
  return {
    blob,
    fileName: `qrferry-offline-${date}.zip`,
    fileCount: Object.keys(files).length,
  };
}
