/**
 * يولّد مصدر نقل بصري حقيقي (نفس مكتبات الإنتاج) داخل بيئة Node،
 * ويعيد الإطارات QR الجاهزة لتغذية كاميرا محاكاة في اختبارات E2E.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initSync as initRaptorQ } from "@raptorqr/raptorq-wasm";
import { encodeQRCodeMatrix } from "@raptorqr/core/qr/qr_encoder_node";
import { compressForTransfer } from "../../lib/compression";
import { encryptPayload } from "../../lib/encryption";
import {
  buildOpticalContainer,
  createOpticalTransfer,
} from "../../lib/optical-transfer";
import { TRANSFER_PRESETS } from "../../lib/transfer-presets";

const require = createRequire(import.meta.url);

let raptorQReady = false;
function prepareRaptorQ() {
  if (raptorQReady) return;
  initRaptorQ({
    module: readFileSync(
      require.resolve(
        "@raptorqr/raptorq-wasm/wasm/raptorqr_raptorq_wasm_bg.wasm",
      ),
    ),
  });
  raptorQReady = true;
}

export type QrFrameData = {
  n: number;
  data: Uint8Array;
};

export type TransferFixture = {
  frames: QrFrameData[];
  originalBytes: Uint8Array;
  packetCount: number;
  symbolSize: number;
  encrypted: boolean;
};

export async function buildTransferFixture(options: {
  bytes: Uint8Array;
  filename?: string;
  mime?: string;
  password?: string;
}): Promise<TransferFixture> {
  prepareRaptorQ();
  const { bytes, filename = "e2e-sample.txt", mime = "text/plain", password } =
    options;
  const compressed = await compressForTransfer(bytes);
  const transmitted = password
    ? await encryptPayload(compressed.bytes, password)
    : compressed.bytes;
  const prepared = buildOpticalContainer(bytes, transmitted, {
    filename,
    mime,
    compression: compressed.mode,
  });
  const preset = TRANSFER_PRESETS.robust;
  const transfer = await createOpticalTransfer(prepared, {
    symbolSize: preset.symbolSize,
    repairPercent: preset.repairPercent,
  });

  const frames: QrFrameData[] = [];
  for (const packet of transfer.packets) {
    const matrix = await encodeQRCodeMatrix(packet, preset.version, preset.ecc);
    const n = matrix.length;
    const data = new Uint8Array(n * n);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        data[y * n + x] = matrix[y][x] ? 1 : 0;
      }
    }
    frames.push({ n, data });
  }

  return {
    frames,
    originalBytes: bytes,
    packetCount: transfer.packets.length,
    symbolSize: preset.symbolSize,
    encrypted: Boolean(password),
  };
}

export function makeCompressibleBytes(targetBytes: number): Uint8Array {
  // سطر متكرر لكن مع عدّاد متغير: ضغط معتدل (≈4-6×) بدل ضغط شبه كامل.
  const encoder = new TextEncoder();
  const output = new Uint8Array(targetBytes);
  const chunks: Uint8Array[] = [];
  let written = 0;
  let index = 0;
  while (written < targetBytes) {
    const line = `QRFerry record ${index}: نقل ملفات عبر الكاميرا — RaptorQ — صف ${index} من البيانات المتكررة المتغيرة\n`;
    const chunk = encoder.encode(line);
    chunks.push(chunk);
    written += chunk.length;
    index += 1;
  }
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= targetBytes) break;
    output.set(chunk.subarray(0, Math.min(chunk.length, targetBytes - offset)), offset);
    offset += Math.min(chunk.length, targetBytes - offset);
  }
  return output;
}
