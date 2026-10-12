import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  // هذه الحزم تُصدَّر كـ TypeScript/ESM خام، فيحتاج Next ترجمتها
  transpilePackages: [
    "@raptorqr/core",
    "@raptorqr/fast-qr-wasm",
    "@raptorqr/raptorq-wasm",
    "zxing-wasm",
  ],
};

export default nextConfig;
