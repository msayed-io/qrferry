import path from "node:path";
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
      test: /\.wasm(\?.*)?$/,
      type: "asset/resource",
    });
    // ربط مباشر لملف wasm الخاص بـ zxing (الـ exports map لا يعلنه)
    if (!config.resolve.alias) config.resolve.alias = {};
    config.resolve.alias["zxing-wasm/reader/zxing_reader.wasm"] = path.resolve(
      process.cwd(),
      "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
    );
    return config;
  },
};

export default nextConfig;
