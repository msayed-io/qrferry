/**
 * خادم QRFerry المدمج للشبكات المعزولة (بدون إنترنت):
 *  - يقدّم ملفات الموقع الثابتة (نفس المجلد).
 *  - يشغّل خادم تسيير PeerJS على المسار /peerjs لنقل الملفات المحلي السريع.
 *
 * التشغيل:
 *   cd server
 *   npm install
 *   node offline-server.mjs [المنفذ] [مسار مجلد الموقع]
 *
 * مثال: node offline-server.mjs 9000 ../dist/client
 * ثم افتح http://localhost:9000 على التلفزيون (أو أي جهاز) وحدد
 * خادم التسيير: ws://<عنوان-هذا-الجهاز>:9000/peerjs
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import express from "express";
import { ExpressPeerServer } from "peer";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 9000);
const SITE_DIR = resolve(process.argv[3] ?? process.env.SITE_DIR ?? "../dist/client");

const app = express();
const server = createServer(app);

// خادم التسيير (PeerJS)
const peerServer = ExpressPeerServer(server, { path: "/peerjs", allow_discovery: false });
app.use("/peerjs", peerServer);

// الملفات الثابتة مع نوع MIME صحيح لـ .wasm (مهم لفك ترميز WebAssembly)
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

app.use((request, response, next) => {
  let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(SITE_DIR, pathname));
  if (!filePath.startsWith(resolve(SITE_DIR))) {
    response.status(403).end("Forbidden");
    return;
  }
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) throw new Error("not a file");
    const type = MIME[extname(filePath)] ?? "application/octet-stream";
    response.setHeader("Content-Type", type);
    response.setHeader("Cache-Control", "no-cache");
    response.end(readFileSync(filePath));
  } catch {
    // SPA fallback: نعيد index.html لمسارات التطبيق (مثل /scan و /tv)
    try {
      const index = readFileSync(join(SITE_DIR, "index.html"));
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(index);
    } catch {
      next();
    }
  }
});

server.listen(PORT, () => {
  console.log(`QRFerry offline server running on http://0.0.0.0:${PORT}`);
  console.log(`Serving site from: ${SITE_DIR}`);
  console.log(`PeerJS signaling at: ws://<this-host>:${PORT}/peerjs`);
});
