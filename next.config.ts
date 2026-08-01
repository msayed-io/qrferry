import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // هذه الحزم تُصدَّر كـ TypeScript/ESM خام، فيحتاج Next ترجمتها
  transpilePackages: [
    "@raptorqr/core",
    "@raptorqr/fast-qr-wasm",
    "@raptorqr/raptorq-wasm",
    "zxing-wasm",
  ],
  webpack(config) {
    // ملفات WebAssembly تُعامَل كأصول (تُرفع كملفات ثابتة وتُسترجع بعناوينها)
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
