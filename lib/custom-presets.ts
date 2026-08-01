/**
 * ملفات الضبط المخصصة (Custom Presets): يضيف المستخدم بروفايلات
 * إرسال خاصة به وتُحفظ في localStorage (محلي بالكامل).
 */

import { createQRTransferProfile } from "@raptorqr/core/protocol/profiles";
import { OPTICAL_FRAME_OVERHEAD } from "./optical-transfer";

const STORAGE_KEY = "qrferry-custom-presets";

export type CustomPreset = {
  id: string;
  label: string;
  description: string;
  version: number;
  ecc: "L" | "M" | "Q" | "H";
  fps: number;
  lanes: 1 | 2;
  repairPercent: number;
  renderScale: number;
};

export function validateCustomPreset(preset: Omit<CustomPreset, "id">): string | null {
  if (!preset.label || preset.label.trim().length < 2) {
    return "اسم البروفايل يجب ألا يقل عن حرفين.";
  }
  if (!Number.isInteger(preset.version) || preset.version < 1 || preset.version > 40) {
    return "إصدار QR يجب أن يكون بين 1 و 40.";
  }
  if (!Number.isInteger(preset.fps) || preset.fps < 1 || preset.fps > 120) {
    return "معدل الإطارات يجب أن يكون بين 1 و 120.";
  }
  if (preset.lanes !== 1 && preset.lanes !== 2) {
    return "عدد المسارات يجب أن يكون 1 أو 2.";
  }
  if (!Number.isInteger(preset.repairPercent) || preset.repairPercent < 0 || preset.repairPercent > 100) {
    return "نسبة الإصلاح يجب أن تكون بين 0 و 100.";
  }
  if (!Number.isInteger(preset.renderScale) || preset.renderScale < 1 || preset.renderScale > 12) {
    return "مقياس الرسم يجب أن يكون بين 1 و 12.";
  }
  return null;
}

export function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => validateCustomPreset(p) === null);
  } catch {
    return [];
  }
}

export function saveCustomPreset(preset: Omit<CustomPreset, "id">): CustomPreset {
  const validation = validateCustomPreset(preset);
  if (validation) throw new Error(validation);
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const full: CustomPreset = { ...preset, id };
  const presets = loadCustomPresets();
  presets.push(full);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return full;
}

export function deleteCustomPreset(id: string): void {
  const presets = loadCustomPresets().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

/** يبني كائن preset كاملاً متوافقاً مع TRANSFER_PRESETS من بروفايل مخصص. */
export function customPresetToTransferPreset(preset: CustomPreset) {
  const qr = createQRTransferProfile(preset.version, preset.ecc);
  return {
    label: preset.label,
    description: preset.description || "بروفايل مخصص",
    version: preset.version,
    fps: preset.fps,
    lanes: preset.lanes,
    ecc: preset.ecc,
    repairPercent: preset.repairPercent,
    renderScale: preset.renderScale,
    qrCapacity: qr.maxPacketSize,
    symbolSize: qr.maxPacketSize - OPTICAL_FRAME_OVERHEAD,
    usefulBytesPerFrame: qr.maxPacketSize - OPTICAL_FRAME_OVERHEAD - 4,
  };
}
