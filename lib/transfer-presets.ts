import { createQRTransferProfile } from "@raptorqr/core/protocol/profiles";
import { OPTICAL_FRAME_OVERHEAD } from "@/lib/optical-transfer";

function makePreset<
  const T extends {
    label: string;
    description: string;
    version: number;
    ecc: "L" | "M" | "Q" | "H";
    fps: number;
    lanes: 1 | 2;
    repairPercent: number;
    renderScale: number;
  },
>(value: T) {
  const qr = createQRTransferProfile(value.version, value.ecc);
  return {
    ...value,
    qrCapacity: qr.maxPacketSize,
    symbolSize: qr.maxPacketSize - OPTICAL_FRAME_OVERHEAD,
    usefulBytesPerFrame:
      qr.maxPacketSize - OPTICAL_FRAME_OVERHEAD - 4,
  };
}

export const TRANSFER_PRESETS = {
  robust: makePreset({
    label: "Robust",
    description: "V15-M · وحدات كاميرا أكبر",
    version: 15,
    fps: 7,
    lanes: 1,
    ecc: "M" as const,
    repairPercent: 35,
    renderScale: 7,
  }),
  balanced: makePreset({
    label: "Balanced",
    description: "V25-M · سرعة مع 15% إصلاح QR",
    version: 25,
    fps: 10,
    lanes: 1,
    ecc: "M" as const,
    repairPercent: 30,
    renderScale: 6,
  }),
  turbo: makePreset({
    label: "Turbo 15",
    description: "V30-L · أربعة تحديثات لكل رمز على 60 هرتز",
    version: 30,
    fps: 15,
    lanes: 1,
    ecc: "L" as const,
    repairPercent: 25,
    renderScale: 6,
  }),
  turbo30: makePreset({
    label: "Turbo 30",
    description: "V30-L · تحديثان لكل رمز على 60 هرتز",
    version: 30,
    fps: 30,
    lanes: 1,
    ecc: "L" as const,
    repairPercent: 30,
    renderScale: 5,
  }),
  turbo60: makePreset({
    label: "Turbo 60 · مزدوج",
    description: "2× V30-L · يبقى كل مسار ثابتاً عند 30 fps",
    version: 30,
    fps: 60,
    lanes: 2,
    ecc: "L" as const,
    repairPercent: 35,
    renderScale: 5,
  }),
  megabit: makePreset({
    label: "1 Mbps · مزدوج (مختبري)",
    description: "2× V40-L · 30 fps لكل مسار · نطاق قريب",
    version: 40,
    fps: 60,
    lanes: 2,
    ecc: "L" as const,
    repairPercent: 35,
    renderScale: 5,
  }),
};

export type TransferPresetKey = keyof typeof TRANSFER_PRESETS;
