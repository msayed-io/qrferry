"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "./lang-provider";
import { WorkspaceDisclosure, WorkspaceDialog } from "./workspace-ui";
import {
  Camera,
  Flame,
  Folder,
  Lock,
  LockOpen,
  Maximize,
  PenLine,
  Radio,
  RefreshCw,
  Zap,
  X,
  QrCode,
} from "lucide-react";
import { compressForTransferViaWorker } from "@/lib/compression-worker";
import { encryptPayload } from "@/lib/encryption";
import {
  buildOpticalContainer,
  createOpticalTransfer,
  formatBytes,
  formatRate,
  MAX_FILE_BYTES,
  OpticalTransfer,
  PreparedOpticalFile,
} from "@/lib/optical-transfer";
import { TRANSFER_PRESETS, TransferPresetKey } from "@/lib/transfer-presets";
import { buildTransferPackage, type PackageFile } from "@/lib/transfer-package";
import {
  exportPrivateKeyPkcs8,
  exportPublicKeyRaw,
  generateSigningKeyPair,
  importPrivateKeyRaw,
  signHash,
  encodePublicKey,
} from "@/lib/signing";
import {
  getStoredIdentity,
  saveStoredIdentity,
  type StoredIdentity,
} from "@/lib/identity-store";
import {
  MAX_BATCH_FILES,
  FileSelectionError,
  planFileSelection,
} from "@/lib/file-selection";
import { takeSharedFiles } from "@/lib/shared-files-store";
import {
  loadCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  customPresetToTransferPreset,
  type CustomPreset,
} from "@/lib/custom-presets";
import { renderRawQr } from "@/lib/qr-renderer";
import { acquireScreenWakeLock } from "@/lib/wakelock";
import {
  decodePairing,
  sendFileFast,
  type PairingInfo,
  type TransferProgress,
} from "@/lib/fast-transfer";

type PreparedFileItem = {
  file: File;
  original: Uint8Array;
  /** حقلان كسولان: يُملآن عند أول تجهيز للبث البصري (ضغط مكلف). */
  compressedBytes?: Uint8Array;
  compressedMode?: "none" | "gzip" | "brotli";
};

type PreparedFiles = {
  items: PreparedFileItem[];
};

type BuiltOptical = {
  optical: PreparedOpticalFile;
  isPackage: boolean;
};

/** إذا كان مجموع الملفات أقل من هذا الحد، يُجهَّز البث البصري تلقائياً عند الاختيار. */
const FAST_PREPARE_THRESHOLD = 1.5 * 1024 * 1024; // 1.5 MB

function evenlyInterleave(source: number[], repair: number[]) {
  if (source.length === 0) return [...repair];
  if (repair.length === 0) return [...source];
  const order: number[] = [];
  let repairIndex = 0;
  let accumulator = 0;
  for (const sourceIndex of source) {
    order.push(sourceIndex);
    accumulator += repair.length;
    while (repairIndex < repair.length && accumulator >= source.length) {
      order.push(repair[repairIndex]);
      repairIndex += 1;
      accumulator -= source.length;
    }
  }
  while (repairIndex < repair.length) {
    order.push(repair[repairIndex]);
    repairIndex += 1;
  }
  return order;
}

function estimateDuration(
  transfer: OpticalTransfer,
  preset: {
    fps: number;
  },
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const seconds = transfer.sourcePacketCount / (preset.fps * 0.78);
  if (seconds < 60) {
    return `${t("send.status.about")} ${Math.max(1, Math.ceil(seconds))} ${t("send.status.sec")}`;
  }
  const minutes = seconds / 60;
  return `${t("send.status.about")} ${minutes >= 10 ? Math.ceil(minutes) : minutes.toFixed(1)} ${t("send.status.min")}`;
}

export function SendClient() {
  const { t, lang } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const qrStageRef = useRef<HTMLDivElement>(null);
  const transferRef = useRef<OpticalTransfer | undefined>(undefined);
  const orderRef = useRef<number[]>([]);
  const playedFramesRef = useRef(0);
  const broadcastFrameTimesRef = useRef<number[]>([]);
  const encodeJobRef = useRef(0);
  const prepareJobRef = useRef(0);
  const preparingRef = useRef(false);
  const appendSelectionRef = useRef(false);
  const [tab, setTab] = useState<"file" | "text">("file");
  const [textValue, setTextValue] = useState("");
  const [fileData, setFileData] = useState<PreparedFiles>();
  const [transfer, setTransfer] = useState<OpticalTransfer>();
  const [presetKey, setPresetKey] = useState<TransferPresetKey>("robust");
  const [playing, setPlaying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [playedFrames, setPlayedFrames] = useState(0);
  const [actualFps, setActualFps] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [encryptEnabled, setEncryptEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [burnEnabled, setBurnEnabled] = useState(false);
  const [signEnabled, setSignEnabled] = useState(false);
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [showPasswordQr, setShowPasswordQr] = useState(false);
  const [showPubKeyQr, setShowPubKeyQr] = useState(false);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [sharedNotice, setSharedNotice] = useState("");
  // النقل السريع (شبكة محلية)
  const [fastOpen, setFastOpen] = useState(false);
  const [fastState, setFastState] = useState<
    "idle" | "scanning" | "connecting" | "transferring" | "done" | "error"
  >("idle");
  const [fastStatus, setFastStatus] = useState("");
  const [fastUrlCopied, setFastUrlCopied] = useState(false);
  const [fastCameraInfo, setFastCameraInfo] = useState("");
  const fastFacingRef = useRef<"environment" | "user">("environment");
  const fastFramesSinceRobustRef = useRef(0);
  const [fastProgress, setFastProgress] = useState<TransferProgress | null>(
    null,
  );
  const fastVideoRef = useRef<HTMLVideoElement>(null);
  const fastCanvasRef = useRef<HTMLCanvasElement>(null);
  const fastStreamRef = useRef<MediaStream | null>(null);
  const fastScanLoopRef = useRef(0);
  const fastScanActiveRef = useRef(false);

  /** نوع موحّد لأي بروفايل (افتراضي أو مخصص). */
  type TransferPresetLike = {
    label: string;
    description: string;
    version: number;
    fps: number;
    lanes: 1 | 2;
    ecc: "L" | "M" | "Q" | "H";
    repairPercent: number;
    renderScale: number;
    qrCapacity: number;
    symbolSize: number;
    usefulBytesPerFrame: number;
  };

  /** يبحث عن البروفايل (الافتراضي أو المخصص) بمفتاحه. */
  const getPreset = useCallback(
    (key: TransferPresetKey): TransferPresetLike => {
      const builtin = TRANSFER_PRESETS[key as keyof typeof TRANSFER_PRESETS];
      if (builtin) return builtin as unknown as TransferPresetLike;
      const custom = customPresets.find((cp) => cp.id === key);
      if (custom) return customPresetToTransferPreset(custom);
      return TRANSFER_PRESETS.robust as unknown as TransferPresetLike;
    },
    [customPresets],
  );
  const preset = getPreset(presetKey);

  // الملفات القادمة من «المشاركة» (Web Share Target)
  useEffect(() => {
    let cancelled = false;
    const job = prepareJobRef.current;
    void takeSharedFiles().then(async (entries) => {
      if (
        cancelled ||
        job !== prepareJobRef.current ||
        !entries ||
        entries.length === 0
      )
        return;
      if (
        entries.length > MAX_BATCH_FILES ||
        entries.reduce((sum, e) => sum + e.data.byteLength, 0) > MAX_FILE_BYTES
      ) {
        setError(
          lang === "ar"
            ? "يمكن إرسال 3 ملفات بحد أقصى، ضمن حد الحجم الإجمالي. اختر دفعة أصغر."
            : "Send up to 3 files within the total size limit. Choose a smaller batch.",
        );
        return;
      }
      try {
        const items: PreparedFileItem[] = [];
        for (const entry of entries) {
          const original = new Uint8Array(entry.data);
          const compressed = await compressForTransferViaWorker(original);
          items.push({
            file: new File([original], entry.name, { type: entry.mime }),
            original,
            compressedBytes: compressed.bytes,
            compressedMode: compressed.mode,
          });
        }
        if (cancelled || job !== prepareJobRef.current) return;
        const prepared: PreparedFiles = { items };
        setFileData(prepared);
        setTab("file");
        setSharedNotice(t("send.sharedPickup", { n: items.length }));
      } catch {
        // تجاهل: المستخدم يختار الملفات يدوياً
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // البروفايلات المخصصة من localStorage (بعد أول رسم)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCustomPresets(loadCustomPresets());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const allPresets = useMemo(() => {
    const entries = Object.entries(TRANSFER_PRESETS) as Array<
      [TransferPresetKey, (typeof TRANSFER_PRESETS)[TransferPresetKey]]
    >;
    const custom = customPresets.map((cp) => ({
      key: cp.id as TransferPresetKey,
      preset: customPresetToTransferPreset(cp),
    }));
    return { entries, custom };
  }, [customPresets]);

  const ensureIdentity = useCallback(async (): Promise<StoredIdentity> => {
    const existing = await getStoredIdentity();
    if (existing) return existing;
    const pair = await generateSigningKeyPair();
    const publicKeyRaw = await exportPublicKeyRaw(pair.publicKey);
    const privateKeyPkcs8 = await exportPrivateKeyPkcs8(pair.privateKey);
    const identity: StoredIdentity = {
      label: "هويتي",
      publicKeyRaw,
      privateKeyPkcs8,
      createdAt: Date.now(),
    };
    await saveStoredIdentity(identity);
    return identity;
  }, []);

  useEffect(() => {
    void ensureIdentity()
      .then((id) => setIdentity(id))
      .catch(() => undefined);
  }, [ensureIdentity]);

  const installTransfer = useCallback((next: OpticalTransfer) => {
    const order = evenlyInterleave(
      next.sourcePacketIndices,
      next.repairPacketIndices,
    );
    transferRef.current = next;
    orderRef.current = order;
    playedFramesRef.current = 0;
    setPlayedFrames(0);
    setTransfer(next);
  }, []);

  const buildOptical = useCallback(
    async (prepared: PreparedFiles): Promise<BuiltOptical> => {
      const activePassword = encryptEnabled ? password.trim() : "";

      if (prepared.items.length === 1 && !signEnabled && !burnEnabled) {
        // المسار الكلاسيكي: ملف واحد بلا توقيع/حذف — بضغط كسول (يُضغط عند الطلب فقط)
        const item = prepared.items[0];
        if (!item.compressedBytes || !item.compressedMode) {
          const compressed = await compressForTransferViaWorker(item.original);
          item.compressedBytes = compressed.bytes;
          item.compressedMode = compressed.mode;
        }
        const transmitted = activePassword
          ? await encryptPayload(item.compressedBytes, activePassword)
          : item.compressedBytes;
        const optical = buildOpticalContainer(item.original, transmitted, {
          filename: item.file.name,
          mime: item.file.type || "application/octet-stream",
          compression: item.compressedMode,
        });
        return { optical, isPackage: false };
      }

      // مسار الحزمة: عدة ملفات أو توقيع/حذف
      const packageFiles: PackageFile[] = prepared.items.map((item) => ({
        name: item.file.name,
        mime: item.file.type || "application/octet-stream",
        bytes: item.original,
      }));

      let packageBytes: Uint8Array;
      if (signEnabled) {
        const id = await ensureIdentity();
        const privateKey = await importPrivateKeyRaw(id.privateKeyPkcs8);
        const unsigned = buildTransferPackage({
          files: packageFiles,
          burnAfterReading: burnEnabled,
        });
        const signature = await signHash(privateKey, unsigned);
        packageBytes = buildTransferPackage({
          files: packageFiles,
          burnAfterReading: burnEnabled,
          signerName: id.label,
          signature,
          signerPublicKey: id.publicKeyRaw,
        });
      } else {
        packageBytes = buildTransferPackage({
          files: packageFiles,
          burnAfterReading: burnEnabled,
        });
      }

      const compressed = await compressForTransferViaWorker(packageBytes);
      const transmitted = activePassword
        ? await encryptPayload(compressed.bytes, activePassword)
        : compressed.bytes;

      const bundleName =
        prepared.items.length > 1
          ? `${prepared.items.length} ${t("send.multiSelected")}`
          : prepared.items[0].file.name;
      const optical = buildOpticalContainer(packageBytes, transmitted, {
        filename: bundleName,
        mime: "application/x-qrferry-package",
        compression: compressed.mode,
      });
      return { optical, isPackage: true };
    },
    [burnEnabled, encryptEnabled, ensureIdentity, password, signEnabled, t],
  );

  const encodePrepared = useCallback(
    async (prepared: PreparedFiles, nextPresetKey: TransferPresetKey) => {
      const job = encodeJobRef.current + 1;
      encodeJobRef.current = job;
      setProcessing(true);
      setError("");
      try {
        const nextPreset = getPreset(nextPresetKey);
        const { optical } = await buildOptical(prepared);
        const next = await createOpticalTransfer(optical, {
          symbolSize: nextPreset.symbolSize,
          repairPercent: nextPreset.repairPercent,
        });
        if (encodeJobRef.current === job) installTransfer(next);
      } catch (cause) {
        if (encodeJobRef.current === job) {
          setTransfer(undefined);
          transferRef.current = undefined;
          setError(
            cause instanceof Error
              ? cause.message
              : t("send.error.streamPrepare"),
          );
        }
      } finally {
        if (encodeJobRef.current === job) setProcessing(false);
      }
    },
    [buildOptical, getPreset, installTransfer, t],
  );

  const prepareFiles = useCallback(
    async (incoming: File[], append = false) => {
      // Do not replace a batch during reading or an active transfer/modal.
      if (preparingRef.current || fastOpen) return;
      const previous = fileData;
      let files: File[];
      try {
        files = planFileSelection(
          previous?.items.map((item) => item.file) ?? [],
          incoming,
          append,
          MAX_FILE_BYTES,
        );
      } catch (cause) {
        setError(
          cause instanceof FileSelectionError && cause.reason === "count"
            ? lang === "ar"
              ? "يمكن إرسال 3 ملفات بحد أقصى في المرة الواحدة. لم تتغير قائمتك؛ أزل ملفًا أو اختر عددًا أقل."
              : "Send up to 3 files at once. Your list is unchanged; remove a file or select fewer files."
            : t("send.error.tooLarge"),
        );
        return;
      }
      const job = ++prepareJobRef.current;
      ++encodeJobRef.current;
      preparingRef.current = true;
      setProcessing(true);
      setError("");
      setPlaying(false);
      setActualFps(0);
      setSharedNotice("");
      // A previous optical payload must never remain available for a new selection.
      setTransfer(undefined);
      transferRef.current = undefined;
      orderRef.current = [];
      playedFramesRef.current = 0;
      setPlayedFrames(0);
      setFileData(undefined);
      try {
        if (!files.length) return;
        const items: PreparedFileItem[] = [];
        for (const file of files) {
          // Reuse already-read bytes when adding/removing; don't read large files again.
          const cached = previous?.items.find((item) => item.file === file);
          items.push(
            cached ?? {
              file,
              original: new Uint8Array(await file.arrayBuffer()),
            },
          );
        }
        if (job !== prepareJobRef.current) return;
        const prepared: PreparedFiles = { items };
        setFileData(prepared);
        const total = items.reduce(
          (sum, item) => sum + item.original.length,
          0,
        );
        if (total <= FAST_PREPARE_THRESHOLD)
          await encodePrepared(prepared, presetKey);
      } catch (cause) {
        if (job === prepareJobRef.current) {
          setFileData(previous);
          setError(
            cause instanceof Error ? cause.message : t("send.error.prepare"),
          );
        }
      } finally {
        if (job === prepareJobRef.current) {
          preparingRef.current = false;
          setProcessing(false);
        }
      }
    },
    [encodePrepared, presetKey, t, lang, fileData, fastOpen],
  );

  const prepareText = useCallback(async () => {
    const text = textValue.trim();
    if (!text) {
      setError(t("send.error.prepare"));
      return;
    }
    const file = new File(
      [new TextEncoder().encode(text)],
      lang === "ar" ? "نص.txt" : "text.txt",
      { type: "text/plain;charset=utf-8" },
    );
    setTab("file");
    setTextValue("");
    await prepareFiles([file]);
  }, [lang, prepareFiles, t, textValue]);

  const changePreset = (nextKey: TransferPresetKey) => {
    setPresetKey(nextKey);
    setPlaying(false);
    setActualFps(0);
    // نُعيد التجهيز فقط إن كان البث البصري جاهزاً (أو الملفات صغيرة)
    if (transfer && fileData) void encodePrepared(fileData, nextKey);
  };

  const changeEncryption = (nextEnabled: boolean) => {
    setEncryptEnabled(nextEnabled);
    if (transfer && fileData && !nextEnabled) {
      void buildOptical(fileData).then(() =>
        encodePrepared(fileData, presetKey),
      );
    }
  };

  const changePassword = (nextPassword: string) => {
    setPassword(nextPassword);
    if (transfer && fileData && encryptEnabled) {
      void encodePrepared(fileData, presetKey);
    }
  };

  const toggleBurn = (next: boolean) => {
    setBurnEnabled(next);
    if (transfer && fileData && next !== burnEnabled)
      void encodePrepared(fileData, presetKey);
  };

  const toggleSign = (next: boolean) => {
    setSignEnabled(next);
    if (transfer && fileData && next !== signEnabled)
      void encodePrepared(fileData, presetKey);
  };

  const renderPacket = useCallback(
    async (
      target: OpticalTransfer,
      packetIndex: number,
      activePreset: TransferPresetLike,
      laneIndex = 0,
    ) => {
      const canvas = canvasRefs.current[laneIndex];
      if (!canvas) return;
      const { renderRawQrViaWorker } = await import("@/lib/qr-render-worker");
      const image = await renderRawQrViaWorker({
        packet: target.packets[packetIndex],
        version: activePreset.version,
        ecc: activePreset.ecc,
        scale: activePreset.renderScale,
      });
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("سطح الرسم غير متاح.");
      context.putImageData(image, 0, 0);
    },
    [],
  );

  useEffect(() => {
    if (!transfer || orderRef.current.length === 0) return;
    void Promise.all(
      Array.from({ length: preset.lanes }, (_, laneIndex) =>
        renderPacket(
          transfer,
          orderRef.current[laneIndex % orderRef.current.length],
          preset,
          laneIndex,
        ),
      ),
    ).catch(() => setError(t("send.error.render")));
  }, [preset, renderPacket, t, transfer]);

  useEffect(() => {
    if (!playing || !transfer) return;
    let cancelled = false;
    let animationFrame = 0;
    // منع نوم الشاشة أثناء البث حتى لا يتوقف العرض على الشاشة الكبيرة
    let releaseWakeLock: (() => void) | null = null;
    void acquireScreenWakeLock().then((release) => {
      if (!cancelled) releaseWakeLock = release;
      else release();
    });
    const interval = 1000 / preset.fps;
    let nextFrameAt = performance.now();
    broadcastFrameTimesRef.current = [];

    const tick = async (now: number) => {
      if (now + 0.5 < nextFrameAt) {
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }
      const activeTransfer = transferRef.current;
      const order = orderRef.current;
      if (!activeTransfer || order.length === 0 || cancelled) return;
      const packetIndex = order[playedFramesRef.current % order.length];
      const laneIndex = playedFramesRef.current % preset.lanes;
      try {
        await renderPacket(activeTransfer, packetIndex, preset, laneIndex);
      } catch {
        setError(t("send.error.stream"));
        setPlaying(false);
        return;
      }
      if (cancelled) return;
      playedFramesRef.current += 1;
      const completedAt = performance.now();
      const frameTimes = broadcastFrameTimesRef.current;
      frameTimes.push(completedAt);
      while (frameTimes.length > 2 && completedAt - frameTimes[0] > 2500) {
        frameTimes.shift();
      }

      const uiInterval = Math.max(1, Math.round(preset.fps / 10));
      if (playedFramesRef.current % uiInterval === 0) {
        setPlayedFrames(playedFramesRef.current);
        if (frameTimes.length > 1) {
          setActualFps(
            ((frameTimes.length - 1) * 1000) /
              (frameTimes[frameTimes.length - 1] - frameTimes[0]),
          );
        }
      }

      nextFrameAt += interval;
      if (nextFrameAt < completedAt - interval) {
        nextFrameAt = completedAt + interval;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      releaseWakeLock?.();
    };
  }, [playing, preset, renderPacket, t, transfer]);

  // ===== النقل السريع (شبكة محلية) =====

  const stopFastScanning = useCallback(() => {
    fastScanActiveRef.current = false;
    if (fastScanLoopRef.current) {
      window.cancelAnimationFrame(fastScanLoopRef.current);
      fastScanLoopRef.current = 0;
    }
    fastStreamRef.current?.getTracks().forEach((track) => track.stop());
    fastStreamRef.current = null;
  }, []);

  const closeFastModal = useCallback(() => {
    stopFastScanning();
    setFastOpen(false);
    setFastState("idle");
    setFastStatus("");
    setFastProgress(null);
  }, [stopFastScanning]);

  const buildPackageForFast = useCallback(async (): Promise<Uint8Array> => {
    if (!fileData) return new Uint8Array(0);
    const { buildTransferPackage } = await import("@/lib/transfer-package");
    const packageFiles = fileData.items.map((item) => ({
      name: item.file.name,
      mime: item.file.type || "application/octet-stream",
      bytes: item.original,
    }));
    if (signEnabled) {
      const id = await ensureIdentity();
      const privateKey = await importPrivateKeyRaw(id.privateKeyPkcs8);
      const unsigned = buildTransferPackage({
        files: packageFiles,
        burnAfterReading: burnEnabled,
      });
      const signature = await signHash(privateKey, unsigned);
      return buildTransferPackage({
        files: packageFiles,
        burnAfterReading: burnEnabled,
        signerName: id.label,
        signature,
        signerPublicKey: id.publicKeyRaw,
      });
    }
    return buildTransferPackage({
      files: packageFiles,
      burnAfterReading: burnEnabled,
    });
  }, [burnEnabled, ensureIdentity, fileData, signEnabled]);

  const beginFastTransfer = useCallback(
    async (pairing: PairingInfo) => {
      if (!fileData) return;
      setFastState("connecting");
      setFastStatus(t("send.fastConnecting"));
      try {
        const items = fileData.items;
        let fileName: string;
        let mime: string;
        let bytes: Uint8Array;

        if (items.length === 1 && !signEnabled && !burnEnabled) {
          // مسار بسيط: ملف واحد يُرسل كما هو (القناة DTLS مشفرة من طرف لطرف)
          fileName = items[0].file.name;
          mime = items[0].file.type || "application/octet-stream";
          bytes = items[0].original;
        } else {
          // حزمة ملفات متعددة / توقيع / حذف → نبني الحزمة (نفس تنسيق QFPA)
          fileName = `${items.length} ${t("send.multiSelected")}`;
          mime = "application/x-qrferry-package";
          bytes = await buildPackageForFast();
        }

        await sendFileFast({
          pairing,
          file: { name: fileName, mime, bytes },
          onProgress: (progress) => {
            setFastProgress(progress);
            setFastState("transferring");
          },
          onStatus: (message) => setFastStatus(message),
        });
        setFastState("done");
        setFastStatus(t("send.fastDone"));
      } catch (cause) {
        setFastState("error");
        setFastStatus(
          t("send.fastError", {
            msg: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    },
    [buildPackageForFast, fileData, signEnabled, burnEnabled, t],
  );

  /** يطلب الكاميرا بدقة عالية، مع احتياط لدقة أقل عند الفشل. */
  const requestCamera = useCallback(
    async (facing: "environment" | "user"): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30 },
          },
        });
      } catch {
        // احتياط: أي كاميرا متاحة (قد تكون دقة أقل لكنها تعمل)
        return navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing } },
        });
      }
    },
    [],
  );

  /** يفعّل التركيز التلقائي المستمر (مهم جداً عند تصوير شاشة — يزيل الضبابية). */
  const enableContinuousFocus = useCallback(async (stream: MediaStream) => {
    try {
      const track = stream.getVideoTracks()[0];
      const capabilities =
        track.getCapabilities?.() as MediaTrackCapabilities & {
          focusMode?: string[];
        };
      if (capabilities?.focusMode?.includes("continuous")) {
        await track
          .applyConstraints({
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
          })
          .catch(() => undefined);
      }
    } catch {
      // التركيز اختياري
    }
  }, []);

  /** يبدأ حلقة المسح على تدفق كاميرا معطى (تُستخدم للبدء والتبديل معاً). */
  const beginFastLoop = useCallback(
    async (stream: MediaStream) => {
      const video = fastVideoRef.current;
      const canvas = fastCanvasRef.current;
      if (!video || !canvas) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      fastStreamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      fastScanActiveRef.current = true;

      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      setFastCameraInfo(
        settings.width && settings.height
          ? `${settings.width}×${settings.height}`
          : "",
      );

      const SCAN_SIZE = 640;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      /** يعيد التقاط التدفق إن انتهى تتبعه (مرونة في كل البيئات). */
      const ensureLiveStream = async (): Promise<boolean> => {
        const current = fastStreamRef.current;
        const currentTrack = current?.getVideoTracks?.()[0];
        if (currentTrack && currentTrack.readyState !== "ended") return true;
        try {
          const fresh = await requestCamera(fastFacingRef.current);
          fastStreamRef.current = fresh;
          video.srcObject = fresh;
          await video.play();
          return true;
        } catch {
          return false;
        }
      };

      const loop = async () => {
        if (!fastScanActiveRef.current) return;
        try {
          if (video.readyState < 2 || video.videoWidth === 0) return;
          if (!(await ensureLiveStream())) return;
          const side = Math.min(video.videoWidth, video.videoHeight);
          const offsetX = Math.floor((video.videoWidth - side) / 2);
          const offsetY = Math.floor((video.videoHeight - side) / 2);
          canvas.width = SCAN_SIZE;
          canvas.height = SCAN_SIZE;
          context.imageSmoothingEnabled = false;
          context.drawImage(
            video,
            offsetX,
            offsetY,
            side,
            side,
            0,
            0,
            SCAN_SIZE,
            SCAN_SIZE,
          );
          const image = context.getImageData(0, 0, SCAN_SIZE, SCAN_SIZE);
          const { scanRawQr } = await import("@/lib/qr-scanner");
          // تكيّف: معظم المحاولات سريعة (بدون tryHarder)؛ وكل 6 محاولات tryHarder
          fastFramesSinceRobustRef.current += 1;
          const robust = fastFramesSinceRobustRef.current % 6 === 5;
          const decoded = await scanRawQr(image, robust);
          if (decoded) {
            const text = new TextDecoder().decode(decoded);
            const pairing = decodePairing(text);
            if (pairing) {
              stopFastScanning();
              await beginFastTransfer(pairing);
              return;
            }
          }
        } catch {
          // أي خطأ غير متوقع: نتجاهله ونواصل — الحلقة لا تموت أبداً
        } finally {
          if (fastScanActiveRef.current) {
            fastScanLoopRef.current = window.requestAnimationFrame(
              () => void loop(),
            );
          }
        }
      };

      fastScanLoopRef.current = window.requestAnimationFrame(() => void loop());
    },
    [beginFastTransfer, requestCamera, stopFastScanning],
  );

  const startFastScan = useCallback(async () => {
    setFastState("scanning");
    setFastStatus(t("send.fastScanning"));
    try {
      // ننتظر ربط React للفيديو داخل النافذة قبل طلب الكاميرا
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      const stream = await requestCamera(fastFacingRef.current);
      await enableContinuousFocus(stream);
      await beginFastLoop(stream);
    } catch {
      setFastState("error");
      setFastStatus(t("send.fastError", { msg: t("scan.error.cameraStart") }));
    }
  }, [beginFastLoop, enableContinuousFocus, requestCamera, t]);

  /** تبديل الكاميرا الأمامية/الخلفية أثناء المسح. */
  const switchFastCamera = useCallback(() => {
    const next =
      fastFacingRef.current === "environment" ? "user" : "environment";
    fastFacingRef.current = next;
    setFastStatus(t("send.fastScanning"));
    void (async () => {
      fastScanActiveRef.current = false;
      if (fastScanLoopRef.current) {
        window.cancelAnimationFrame(fastScanLoopRef.current);
        fastScanLoopRef.current = 0;
      }
      fastStreamRef.current?.getTracks().forEach((track) => track.stop());
      fastStreamRef.current = null;
      try {
        const stream = await requestCamera(next);
        await enableContinuousFocus(stream);
        await beginFastLoop(stream);
      } catch {
        setFastState("error");
        setFastStatus(
          t("send.fastError", { msg: t("scan.error.cameraStart") }),
        );
      }
    })();
  }, [beginFastLoop, enableContinuousFocus, requestCamera, t]);

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      setTab("file");
      void prepareFiles(files, appendSelectionRef.current);
    }
    appendSelectionRef.current = false;
    event.target.value = "";
  };

  const selectFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      setTab("file");
      void prepareFiles(files);
    }
    event.target.value = "";
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      setTab("file");
      void prepareFiles(files, !!fileData);
    }
  };

  const scanUrl = useMemo(() => {
    if (typeof window === "undefined") return "/scan";
    return `${window.location.origin}/scan`;
  }, []);

  // Pair with this installation, not a hard-coded deployment with potentially older receiver code.
  const tvUrl = useMemo(() => {
    if (typeof window === "undefined") return "/tv";
    return `${window.location.origin}/tv`;
  }, []);

  const copyScanLink = async () => {
    try {
      await navigator.clipboard.writeText(scanUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t("send.error.copy"));
    }
  };

  const toggleFullscreen = async () => {
    if (!qrStageRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        setActualFps(0);
        setPlaying(true);
        await qrStageRef.current.requestFullscreen();
      }
    } catch {
      setPlaying(false);
      setError(t("send.error.fullscreen"));
    }
  };

  const renderTextQr = useCallback(async (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const image = await renderRawQr(bytes, 5, "M", 8);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d");
    context.putImageData(image, 0, 0);
    return canvas;
  }, []);

  const [passwordQrCanvas, setPasswordQrCanvas] =
    useState<HTMLCanvasElement | null>(null);
  const [pubKeyQrCanvas, setPubKeyQrCanvas] =
    useState<HTMLCanvasElement | null>(null);
  const passwordQrHostRef = useRef<HTMLDivElement>(null);
  const pubKeyQrHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPasswordQr) return;
    let cancelled = false;
    void renderTextQr(`QFPW:${password}`).then((canvas) => {
      if (!cancelled) setPasswordQrCanvas(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [password, renderTextQr, showPasswordQr]);

  useEffect(() => {
    if (!showPubKeyQr || !identity) return;
    let cancelled = false;
    void renderTextQr(encodePublicKey(identity.publicKeyRaw)).then((canvas) => {
      if (!cancelled) setPubKeyQrCanvas(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [identity, renderTextQr, showPubKeyQr]);

  useEffect(() => {
    if (passwordQrCanvas && passwordQrHostRef.current) {
      passwordQrHostRef.current.replaceChildren(passwordQrCanvas);
    }
  }, [passwordQrCanvas]);

  useEffect(() => {
    if (pubKeyQrCanvas && pubKeyQrHostRef.current) {
      pubKeyQrHostRef.current.replaceChildren(pubKeyQrCanvas);
    }
  }, [pubKeyQrCanvas]);

  // اختصارات لوحة المفاتيح (بعد تعريف كل الدوال)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (
        typing ||
        document.querySelector('[aria-modal="true"]') ||
        target?.closest("button,a,summary,[role=button]")
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        inputRef.current?.click();
      } else if (event.code === "Space") {
        if (transfer && !processing) {
          event.preventDefault();
          setPlaying((current) => !current);
        }
      } else if (event.key.toLowerCase() === "f") {
        if (qrStageRef.current) {
          event.preventDefault();
          void toggleFullscreen();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer, processing]);

  const submitPreset = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") ?? "");
    const version = Number(form.get("version"));
    const ecc = String(form.get("ecc")) as CustomPreset["ecc"];
    const fps = Number(form.get("fps"));
    const lanes = Number(form.get("lanes")) as 1 | 2;
    const repairPercent = Number(form.get("repair"));
    try {
      saveCustomPreset({
        label,
        description: t("send.presetCustom"),
        version,
        ecc,
        fps,
        lanes,
        repairPercent,
        renderScale: 5,
      });
      setCustomPresets(loadCustomPresets());
      setShowPresetForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removePreset = (id: string) => {
    deleteCustomPreset(id);
    setCustomPresets(loadCustomPresets());
  };

  const orderLength = transfer?.packets.length ?? 0;
  const cycleFrame =
    orderLength > 0
      ? playedFrames === 0
        ? 0
        : ((playedFrames - 1) % orderLength) + 1
      : 0;
  const cycleNumber =
    orderLength > 0 && playedFrames > 0
      ? Math.floor((playedFrames - 1) / orderLength) + 1
      : 1;
  const cycleProgress = orderLength ? cycleFrame / orderLength : 0;
  const nominalRate = preset.usefulBytesPerFrame * preset.fps;
  const passwordTooShort = encryptEnabled && password.trim().length < 4;
  const totalOriginalSize = fileData
    ? fileData.items.reduce((sum, item) => sum + item.original.length, 0)
    : 0;

  return (
    <main
      className={`transfer-page sender-page ${broadcastEnabled ? "broadcast-active" : ""}`}
    >
      <section className="workspace-intro">
        <h1>{t("send.hero")}</h1>
        <p>
          {lang === "ar"
            ? "اختر ملفاتك، ثم أرسلها عبر الشبكة أو بثّ QR."
            : "Choose your files. Send over Wi-Fi or a QR stream."}
        </p>
      </section>

      <section className="sender-grid" aria-label="إنشاء نقل عبر QR">
        <div
          className={`control-panel ${dragging ? "dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={dropFiles}
        >
          <div className="step-heading">
            <span>01</span>
            <div>
              <h2>{t("send.step1.title")}</h2>
              <p>
                {lang === "ar"
                  ? "حتى 3 ملفات · 512 MB إجمالًا"
                  : "Up to 3 files · 512 MB total"}
              </p>
            </div>
          </div>

          <div hidden>
            <input
              ref={inputRef}
              type="file"
              multiple
              onChange={selectFiles}
              aria-label={
                lang === "ar"
                  ? "اختر حتى 3 ملفات للنقل"
                  : "Choose up to 3 files to send"
              }
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={selectFolder}
              aria-label="اختر مجلداً كاملاً للنقل"
              {...({ webkitdirectory: "" } as Record<string, string>)}
            />
          </div>

          <div className="send-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "file"}
              className={tab === "file" ? "selected" : ""}
              onClick={() => setTab("file")}
            >
              {t("send.fileTab")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "text"}
              className={tab === "text" ? "selected" : ""}
              onClick={() => setTab("text")}
            >
              {t("send.textTab")}
            </button>
          </div>

          {tab === "file" ? (
            <div
              className={`drop-zone ${dragging ? "dragging" : ""}`}
              hidden={!!fileData}
            >
              <button
                className="file-button"
                type="button"
                disabled={processing}
                onClick={() => {
                  appendSelectionRef.current = false;
                  inputRef.current?.click();
                }}
              >
                <span aria-hidden="true">{processing ? "…" : "＋"}</span>
                {processing ? t("send.processing") : t("send.browse")}
              </button>
              <button
                className="file-button folder-button"
                type="button"
                disabled={processing}
                onClick={() => folderInputRef.current?.click()}
              >
                <Folder size={16} aria-hidden="true" />
                {lang === "ar" ? "اختيار مجلد" : "Pick a folder"}
              </button>
              <p className="batch-hint">
                {lang === "ar"
                  ? "أو اسحب الملفات إلى هنا"
                  : "Or drop files here"}
              </p>
            </div>
          ) : (
            <div className="text-entry">
              <textarea
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
                placeholder={t("send.textPlaceholder")}
                aria-label={t("send.textPlaceholder")}
              />
              <button
                type="button"
                className="file-button"
                disabled={processing || textValue.trim().length === 0}
                onClick={() => void prepareText()}
              >
                {t("send.textConvert")}
              </button>
            </div>
          )}

          {sharedNotice ? (
            <p className="resume-note" role="status">
              {sharedNotice}
            </p>
          ) : null}

          {fileData ? (
            <div className="selected-files">
              {fileData.items.map((item, index) => (
                <div
                  className="file-row batch-file"
                  key={`${item.file.name}-${index}`}
                >
                  <span className="file-glyph" aria-hidden="true">
                    ↗
                  </span>
                  <span className="fname">{item.file.name}</span>
                  <span className="fmeta">
                    {formatBytes(item.file.size)}
                    {item.compressedBytes && item.compressedMode !== "none"
                      ? ` → ${formatBytes(item.compressedBytes.length)} · ${item.compressedMode}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="remove-file"
                    disabled={processing || fastOpen}
                    aria-label={
                      lang === "ar"
                        ? `إزالة ${item.file.name}`
                        : `Remove ${item.file.name}`
                    }
                    onClick={() =>
                      void prepareFiles(
                        fileData.items
                          .filter((_, i) => i !== index)
                          .map((item) => item.file),
                      )
                    }
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="file-row batch-summary" key="total">
                <span className="fname">
                  {fileData.items.length} / {MAX_BATCH_FILES}{" "}
                  {t("send.multiSelected")}
                </span>
                <span className="fmeta">
                  {formatBytes(totalOriginalSize)}
                  {encryptEnabled && password.trim().length >= 4 ? (
                    <span className="encrypted-badge">
                      <Lock size={11} aria-hidden="true" />{" "}
                      {t("send.encryptedBadge")}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={processing || fastOpen}
                  onClick={() => {
                    appendSelectionRef.current = false;
                    inputRef.current?.click();
                  }}
                >
                  {t("send.change")}
                </button>
              </div>
              <button
                type="button"
                className="batch-add"
                hidden={fileData.items.length >= MAX_BATCH_FILES}
                disabled={
                  processing ||
                  fastOpen ||
                  fileData.items.length >= MAX_BATCH_FILES
                }
                onClick={() => {
                  appendSelectionRef.current = true;
                  inputRef.current?.click();
                }}
              >
                {fileData.items.length >= MAX_BATCH_FILES
                  ? lang === "ar"
                    ? "اكتملت الدفعة: 3 ملفات"
                    : "Batch full: 3 files"
                  : lang === "ar"
                    ? "＋ إضافة ملف للدفعة"
                    : "＋ Add a file to this batch"}
              </button>
            </div>
          ) : null}

          <div className="quick-send">
            <button
              className="fast-action"
              type="button"
              disabled={!fileData}
              onClick={() => {
                setFastOpen(true);
                setFastState("idle");
                setFastStatus("");
                setFastProgress(null);
              }}
            >
              <Zap size={20} aria-hidden="true" />
              <span>
                <strong>{t("send.fast")}</strong>
              </span>
            </button>
            <p className="workspace-note">{t("send.fastSameNetwork")}</p>
          </div>
          <WorkspaceDisclosure
            className="privacy-settings"
            title={
              lang === "ar"
                ? "الخصوصية وخيارات إضافية"
                : "Privacy & more options"
            }
            badge={
              encryptEnabled || signEnabled || burnEnabled || broadcastEnabled
                ? lang === "ar"
                  ? "مفعّلة"
                  : "Active"
                : undefined
            }
          >
            <div className="advanced-panel">
              {/* التشفير */}
              <div className={`adv-option ${encryptEnabled ? "on" : ""}`}>
                <button
                  type="button"
                  className="adv-toggle"
                  aria-pressed={encryptEnabled}
                  onClick={() => changeEncryption(!encryptEnabled)}
                >
                  <span className="adv-glyph" aria-hidden="true">
                    {encryptEnabled ? (
                      <LockOpen size={14} aria-hidden="true" />
                    ) : (
                      <Lock size={14} aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    {encryptEnabled
                      ? t("send.encryptPanel.on")
                      : t("send.encryptPanel.off")}
                  </span>
                </button>
                {encryptEnabled ? (
                  <div className="adv-body">
                    <div className="encrypt-field">
                      <label htmlFor="send-password">
                        {t("send.password")}
                      </label>
                      <input
                        id="send-password"
                        className="password-input"
                        type="password"
                        dir="ltr"
                        autoComplete="off"
                        value={password}
                        placeholder={t("send.passwordPlaceholder")}
                        onChange={(event) => changePassword(event.target.value)}
                      />
                      <p className="encrypt-hint">{t("send.encryptHint.on")}</p>
                      <div className="adv-inline">
                        <button
                          type="button"
                          className="mini-btn"
                          disabled={passwordTooShort}
                          onClick={() => setShowPasswordQr(true)}
                        >
                          {t("send.showPasswordQr")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* الحذف بعد القراءة */}
              <div className={`adv-option ${burnEnabled ? "on" : ""}`}>
                <button
                  type="button"
                  className="adv-toggle"
                  aria-pressed={burnEnabled}
                  onClick={() => toggleBurn(!burnEnabled)}
                >
                  <span className="adv-glyph" aria-hidden="true">
                    <Flame size={15} />
                  </span>
                  <span>{t("send.burnLabel")}</span>
                </button>
                {burnEnabled ? (
                  <p className="adv-hint">{t("send.burnHint")}</p>
                ) : null}
              </div>

              {/* التوقيع الرقمي */}
              <div className={`adv-option ${signEnabled ? "on" : ""}`}>
                <button
                  type="button"
                  className="adv-toggle"
                  aria-pressed={signEnabled}
                  onClick={() => toggleSign(!signEnabled)}
                >
                  <span className="adv-glyph" aria-hidden="true">
                    <PenLine size={15} />
                  </span>
                  <span>{t("send.signLabel")}</span>
                </button>
                {signEnabled ? (
                  <div className="adv-body">
                    <p className="identity-line">
                      {t("send.signIdentity")}{" "}
                      <strong>
                        {identity?.label ?? t("send.signNoIdentity")}
                      </strong>
                    </p>
                    <div className="adv-inline">
                      <button
                        type="button"
                        className="mini-btn"
                        disabled={!identity}
                        onClick={() => setShowPubKeyQr(true)}
                      >
                        {t("send.signShowPub")}
                      </button>
                    </div>
                    <p className="adv-hint">{t("send.signHint")}</p>
                  </div>
                ) : null}
              </div>

              {/* البث الجماعي */}
              <div className={`adv-option ${broadcastEnabled ? "on" : ""}`}>
                <button
                  type="button"
                  className="adv-toggle"
                  aria-pressed={broadcastEnabled}
                  onClick={() => setBroadcastEnabled((current) => !current)}
                >
                  <span className="adv-glyph" aria-hidden="true">
                    <Radio size={15} />
                  </span>
                  <span>{t("send.broadcastLabel")}</span>
                </button>
                {broadcastEnabled ? (
                  <p className="adv-hint">{t("send.broadcastHint")}</p>
                ) : null}
              </div>
            </div>
          </WorkspaceDisclosure>
          <WorkspaceDisclosure
            className="broadcast-settings"
            title={lang === "ar" ? "إعدادات بثّ QR" : "QR stream settings"}
            badge={preset.label}
          >
            <div
              className="preset-list"
              role="radiogroup"
              aria-label="ملف ضبط الإشارة"
            >
              {allPresets.entries.map(([key, option]) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={presetKey === key}
                  className={presetKey === key ? "selected" : ""}
                  key={key}
                  onClick={() => changePreset(key)}
                >
                  <span className="radio-dot" aria-hidden="true" />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{t(`preset.${key}`)}</small>
                  </span>
                  <b>
                    {option.lanes === 1
                      ? `${option.fps} fps`
                      : `${option.fps} ${lang === "ar" ? "رمز/ث" : "sym/s"} · ${option.fps / option.lanes} fps/${lang === "ar" ? "مسار" : "lane"}`}
                    {" · "}
                    {formatRate(option.usefulBytesPerFrame * option.fps)}
                  </b>
                </button>
              ))}
              {allPresets.custom.map(({ key, preset: option }) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={presetKey === key}
                  className={presetKey === key ? "selected" : ""}
                  key={key}
                  onClick={() => changePreset(key)}
                >
                  <span className="radio-dot" aria-hidden="true" />
                  <span>
                    <strong>{option.label} ⭐</strong>
                    <small>{option.description}</small>
                  </span>
                  <b>
                    {option.lanes === 1
                      ? `${option.fps} fps`
                      : `${option.fps} ${lang === "ar" ? "رمز/ث" : "sym/s"} · ${option.fps / option.lanes} fps/${lang === "ar" ? "مسار" : "lane"}`}
                    {" · "}
                    {formatRate(
                      (option.usefulBytesPerFrame ?? 0) * option.fps,
                    )}{" "}
                    <span
                      className="preset-delete"
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        removePreset(key);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.stopPropagation();
                          removePreset(key);
                        }
                      }}
                      aria-label="حذف البروفايل"
                    >
                      ✕
                    </span>
                  </b>
                </button>
              ))}
              <button
                type="button"
                className="preset-add"
                onClick={() => setShowPresetForm((current) => !current)}
              >
                {t("send.addPreset")}
              </button>
            </div>

            {showPresetForm ? (
              <form className="preset-form" onSubmit={submitPreset}>
                <label>
                  {t("send.presetName")}
                  <input name="label" required minLength={2} maxLength={24} />
                </label>
                <div className="form-row">
                  <label>
                    {t("send.presetVersion")}
                    <input
                      name="version"
                      type="number"
                      min={1}
                      max={40}
                      defaultValue={25}
                    />
                  </label>
                  <label>
                    {t("send.presetEcc")}
                    <select name="ecc" defaultValue="M">
                      <option value="L">L</option>
                      <option value="M">M</option>
                      <option value="Q">Q</option>
                      <option value="H">H</option>
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    {t("send.presetFps")}
                    <input
                      name="fps"
                      type="number"
                      min={1}
                      max={120}
                      defaultValue={10}
                    />
                  </label>
                  <label>
                    {t("send.presetLanes")}
                    <select name="lanes" defaultValue="1">
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </label>
                </div>
                <label>
                  {t("send.presetRepair")}
                  <input
                    name="repair"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={30}
                  />
                </label>
                <div className="form-actions">
                  <button type="submit">{t("send.presetSave")}</button>
                  <button
                    type="button"
                    onClick={() => setShowPresetForm(false)}
                  >
                    {t("send.presetCancel")}
                  </button>
                </div>
              </form>
            ) : null}

            {preset.fps >= 30 ? (
              <p className="channel-warning">
                {preset.lanes === 2
                  ? t("send.channelWarningDual")
                  : t("send.channelWarningFast")}
              </p>
            ) : null}
          </WorkspaceDisclosure>

          {passwordTooShort ? (
            <p className="error-message" role="alert">
              {t("send.error.passwordShort")}
            </p>
          ) : null}

          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="qr-panel">
          <div className="step-heading">
            <span>02</span>
            <div>
              <h2>{t("send.step3.title")}</h2>
              <p>
                {preset.lanes === 2
                  ? t("send.step3.descDual")
                  : lang === "ar"
                    ? "دون شبكة · افتح «المسح» على الجهاز الآخر"
                    : "No network · open Scan on the other device"}
              </p>
            </div>
          </div>

          <div
            ref={qrStageRef}
            className={`qr-stage ${transfer ? "ready" : ""} ${playing ? "playing" : ""} lanes-${preset.lanes}`}
          >
            {transfer ? (
              <div className={`qr-canvas-grid lanes-${preset.lanes}`}>
                {Array.from({ length: preset.lanes }, (_, laneIndex) => (
                  <canvas
                    key={laneIndex}
                    ref={(canvas) => {
                      canvasRefs.current[laneIndex] = canvas;
                    }}
                    aria-label={
                      preset.lanes === 1
                        ? "بثّ نقل ملفات RaptorQ متحرك"
                        : `بثّ نقل ملفات RaptorQ متحرك — المسار ${laneIndex + 1}`
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="workspace-qr-empty">
                <QrCode size={54} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  {processing
                    ? t("send.qr.placeholderEncoding")
                    : t("send.qr.placeholderIdle")}
                </span>
              </div>
            )}
            <button
              className="fullscreen-button"
              type="button"
              onClick={toggleFullscreen}
              disabled={!transfer}
              aria-label={t("send.qr.fullscreen")}
            >
              <Maximize size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="stream-status" aria-live="polite">
            <div>
              <span
                className={`pulse-dot ${playing ? "live" : ""}`}
                aria-hidden="true"
              />
              <strong>
                {playing
                  ? t("send.status.broadcasting")
                  : transfer
                    ? t("send.status.ready")
                    : processing
                      ? t("send.status.encoding")
                      : t("send.status.waiting")}
              </strong>
            </div>
          </div>

          {transfer ? (
            <div className="broadcast-progress">
              <div>
                <strong>
                  {t("send.progress.cycle")} {cycleNumber}
                </strong>
                <span>
                  {t("send.progress.frame")} {cycleFrame.toLocaleString()} /{" "}
                  {orderLength.toLocaleString()} ·{" "}
                  {transfer.sourcePacketCount.toLocaleString()}{" "}
                  {t("send.progress.source")} +{" "}
                  {transfer.repairPacketIndices.length.toLocaleString()}{" "}
                  {t("send.progress.repair")}
                </span>
              </div>
              <div
                className="broadcast-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(cycleProgress * 100)}
              >
                <span style={{ width: `${cycleProgress * 100}%` }} />
              </div>
            </div>
          ) : null}

          <button
            className="primary-action"
            type="button"
            disabled={!fileData || processing || passwordTooShort}
            onClick={() => {
              if (!transfer) {
                // الملف كبير ولم يُجهَّز بعد — نجهّز البث البصري عند الطلب
                if (fileData) void encodePrepared(fileData, presetKey);
                return;
              }
              if (!playing) setActualFps(0);
              setPlaying((current) => !current);
            }}
          >
            <span aria-hidden="true">
              {playing ? "Ⅱ" : transfer ? "▶" : processing ? "…" : "▶"}
            </span>
            {playing
              ? t("send.pause")
              : transfer
                ? t("send.start")
                : processing
                  ? t("send.preparing")
                  : t("send.start")}
          </button>

          {/* توصية النقل السريع للملفات الكبيرة (لم يُجهَّز البث تلقائياً) */}
          {fileData && !transfer && !processing ? (
            <p className="fast-recommend" role="status">
              <Zap size={14} aria-hidden="true" /> {t("send.fastRecommend")}
            </p>
          ) : null}

          <button className="link-action" type="button" onClick={copyScanLink}>
            <span aria-hidden="true">⌁</span>
            {copied ? t("send.copied") : t("send.copyScanLink")}
          </button>

          <WorkspaceDisclosure
            className="stream-details"
            title={lang === "ar" ? "تفاصيل البث" : "Stream details"}
          >
            <span>
              {transfer
                ? `${estimateDuration(transfer, preset, t)} · ${t("send.status.nominal")} ${formatRate(nominalRate)}${
                    playing && actualFps > 0
                      ? ` · ${actualFps.toFixed(1)} fps ${t("send.status.renderedFps")}`
                      : ""
                  }`
                : t("send.status.cameraNeverNeeds")}
            </span>
            <p>{t("send.keyboardHint")}</p>
          </WorkspaceDisclosure>
        </div>
      </section>

      {/* نافذة QR كلمة المرور */}
      {showPasswordQr ? (
        <WorkspaceDialog
          title={t("send.passwordQrTitle")}
          onClose={() => setShowPasswordQr(false)}
        >
          <h3>{t("send.passwordQrTitle")}</h3>
          <p>{t("send.passwordQrNote")}</p>
          <div ref={passwordQrHostRef}>
            {!passwordQrCanvas ? <p>…</p> : null}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={() => setShowPasswordQr(false)}
          >
            {t("send.close")}
          </button>
        </WorkspaceDialog>
      ) : null}

      {/* نافذة النقل السريع (شبكة محلية) */}
      {fastOpen ? (
        <WorkspaceDialog
          title={t("send.fastModalTitle")}
          onClose={closeFastModal}
          className="fast-modal"
        >
          <h3>
            <Zap size={22} aria-hidden="true" /> {t("send.fastModalTitle")}
          </h3>

          {/* الفيديو والكانفاس مثبّتان دائماً داخل النافذة (مخفيان عند عدم المسح)
                حتى يتوفر المرجع فوراً عند بدء المسح — يتجنب سباق تركيب React. */}
          <video
            ref={fastVideoRef}
            playsInline
            muted
            className="fast-video"
            style={{ display: fastState === "scanning" ? "block" : "none" }}
          />
          <canvas ref={fastCanvasRef} hidden />

          {fastState === "idle" ? (
            <>
              <ol className="fast-steps">
                <li>
                  {t("send.fastStep1")}{" "}
                  <button
                    type="button"
                    className="fast-url-copy"
                    onClick={() => {
                      void navigator.clipboard.writeText(tvUrl).then(() => {
                        setFastUrlCopied(true);
                        window.setTimeout(() => setFastUrlCopied(false), 2000);
                      });
                    }}
                  >
                    {fastUrlCopied ? t("send.urlCopied") : t("send.copyUrl")}
                  </button>
                  <code className="fast-url">{tvUrl}</code>
                </li>
                <li>{t("send.fastStep2")}</li>
              </ol>
              <p className="fast-hint">{t("send.fastSameNetwork")}</p>
              <div className="fast-actions">
                <button
                  type="button"
                  className="primary-action fast-start"
                  onClick={() => void startFastScan()}
                >
                  <Camera size={18} aria-hidden="true" /> {t("send.fastScan")}
                </button>
                <button
                  type="button"
                  className="modal-close"
                  onClick={closeFastModal}
                >
                  {t("send.fastCancel")}
                </button>
              </div>
            </>
          ) : fastState === "scanning" ? (
            <>
              <p className="fast-status">{fastStatus}</p>
              {fastCameraInfo ? (
                <p className="fast-camera-info">
                  <Camera size={12} aria-hidden="true" />{" "}
                  {t("send.fastRes", { info: fastCameraInfo })}
                </p>
              ) : null}
              <p className="fast-hint">{t("send.fastHintKeepQr")}</p>
              <div className="fast-actions">
                <button
                  type="button"
                  className="fast-switch-cam"
                  onClick={switchFastCamera}
                >
                  <RefreshCw size={16} aria-hidden="true" />{" "}
                  {t("send.fastSwitchCamera")}
                </button>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => {
                    stopFastScanning();
                    setFastState("idle");
                    setFastStatus("");
                  }}
                >
                  {t("send.fastStop")}
                </button>
              </div>
            </>
          ) : fastState === "connecting" || fastState === "transferring" ? (
            <>
              <p className="fast-status">{fastStatus}</p>
              <div className="fast-progress-track">
                <span
                  style={{
                    width: fastProgress
                      ? `${Math.min(100, (fastProgress.sent / fastProgress.total) * 100)}%`
                      : "8%",
                  }}
                />
              </div>
              {fastProgress ? (
                <p className="fast-progress-text">
                  {formatBytes(fastProgress.sent)} /{" "}
                  {formatBytes(fastProgress.total)}
                </p>
              ) : null}
              <div className="fast-actions">
                <button
                  type="button"
                  className="modal-close"
                  onClick={closeFastModal}
                >
                  {t("send.fastCancel")}
                </button>
              </div>
            </>
          ) : fastState === "done" ? (
            <>
              <p className="fast-status fast-ok" role="status">
                {fastStatus}
              </p>
              <div className="fast-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={closeFastModal}
                >
                  {t("send.fastClose")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="fast-status fast-err" role="alert">
                {fastStatus}
              </p>
              <p className="fast-hint">{t("send.fastFallback")}</p>
              <div className="fast-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => void startFastScan()}
                >
                  <Camera size={18} aria-hidden="true" /> {t("send.fastScan")}
                </button>
                <button
                  type="button"
                  className="modal-close"
                  onClick={closeFastModal}
                >
                  {t("send.fastCancel")}
                </button>
              </div>
            </>
          )}
        </WorkspaceDialog>
      ) : null}

      {/* نافذة المفتاح العام */}
      {showPubKeyQr ? (
        <WorkspaceDialog
          title={t("send.signShowPub")}
          onClose={() => setShowPubKeyQr(false)}
        >
          <h3>{t("send.signShowPub")}</h3>
          <p>
            {identity
              ? `${identity.label} · ${identity.publicKeyRaw.length * 8} bit`
              : t("send.signNoIdentity")}
          </p>
          <div ref={pubKeyQrHostRef}>{!pubKeyQrCanvas ? <p>…</p> : null}</div>
          <button
            type="button"
            className="modal-close"
            onClick={() => setShowPubKeyQr(false)}
          >
            {t("send.close")}
          </button>
        </WorkspaceDialog>
      ) : null}
    </main>
  );
}
