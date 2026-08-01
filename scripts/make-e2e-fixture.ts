/**
 * يولّد ملف بيانات ثابت (JSON) لاختبارات E2E باستخدام نفس مكتبات الإنتاج.
 *
 * يُشغَّل عبر tsx (الذي يترجم حزم TypeScript مثل @raptorqr/core):
 *   node --import tsx scripts/make-e2e-fixture.ts
 *
 * الناتج: .e2e/fixtures.json — بيانات خام يقرؤها Playwright بلا أي استيراد
 * من node_modules، فيتجنب قيد مترجم Playwright مع ملفات TS الخارجية.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTransferFixture,
  makeCompressibleBytes,
} from "../e2e/helpers/transfer-fixture";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".e2e");
mkdirSync(outDir, { recursive: true });

type SerializedFrame = { n: number; dataB64: string };

function serializeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function buildSerialized(options: {
  bytes: Uint8Array;
  password?: string;
}) {
  const fixture = await buildTransferFixture(options);
  const frames: SerializedFrame[] = fixture.frames.map((frame) => ({
    n: frame.n,
    dataB64: serializeBytes(frame.data),
  }));
  return {
    frames,
    originalBytesB64: serializeBytes(fixture.originalBytes),
    packetCount: fixture.packetCount,
    symbolSize: fixture.symbolSize,
    encrypted: fixture.encrypted,
  };
}

const output = {
  plain: await buildSerialized({ bytes: makeCompressibleBytes(400_000) }),
  encrypted: await buildSerialized({
    bytes: makeCompressibleBytes(250_000),
    password: "secret-pass",
  }),
};

const target = join(outDir, "fixtures.json");
writeFileSync(target, `${JSON.stringify(output)}\n`, "utf8");
console.log(`✓ وُلّدت بيانات E2E: ${target}`);
console.log(
  `  plain: ${output.plain.frames.length} إطاراً · encrypted: ${output.encrypted.frames.length} إطاراً`,
);
