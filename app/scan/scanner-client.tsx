"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../lang-provider";
import { WorkspaceDisclosure } from "../workspace-ui";
import { Bird, Check, Download, Camera } from "lucide-react";
import { decompressTransfer } from "@/lib/compression";
import { decryptPayload } from "@/lib/encryption";
import {
  crc32,
  formatBytes,
  formatRate,
  parseOpticalContainer,
  parseOpticalFrame,
  raptorPacketKey,
} from "@/lib/optical-transfer";
import {
  evictOldSessions,
  loadSession,
  MAX_SYMBOLS_STORED,
  payloadSymbolKey,
  saveSession,
  sessionKey,
  deleteSession,
} from "@/lib/resume-store";
import {
  isTransferPackage,
  parseTransferPackage,
  buildTransferPackage,
} from "@/lib/transfer-package";
import {
  decodePublicKey,
  importPublicKeyRaw,
  verifySignature,
  formatPublicKeyFingerprint,
} from "@/lib/signing";
import { addTrustedKey, getTrustedKeys } from "@/lib/identity-store";
import { addHistoryEntry } from "@/lib/history-store";
import { acquireScreenWakeLock } from "@/lib/wakelock";
import { notifyTransferComplete } from "@/lib/transfer-notify";
import { StabilityTracker } from "@/lib/stability";

type ScanState =
  | "idle"
  | "starting"
  | "scanning"
  | "receiving"
  | "password"
  | "signature-review"
  | "complete"
  | "error";
type ScanMode = "single" | "dual";
type RateSample = { at: number; bytes: number };
type RaptorDecoder = { push(payload: Uint8Array): Uint8Array | null };
type ReceiverSession = {
  session: number;
  containerLength: number;
  originalSize: number;
  compressed: boolean;
  symbolSize: number;
  sourcePacketCount: number;
  decoder: RaptorDecoder;
  seen: Set<string>;
};
type IncomingMeta = Omit<ReceiverSession, "decoder" | "seen">;
type RecoveredFile = { name: string; mime: string; bytes: Uint8Array };
type PendingDecryption = {
  container: Uint8Array;
  session: ReceiverSession;
  recovered: ReturnType<typeof parseOpticalContainer>;
};
type SignatureReview = {
  signerName: string | null;
  publicKeyRaw: Uint8Array;
  fingerprint: string;
  proceed: (trust: boolean) => void;
};
type VideoFrameMetadataLike = {
  presentedFrames?: number;
};
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadataLike) => void,
  ) => number;
};
type DeliverySample = { at: number; frames: number };
type ScanPerformanceSample = {
  at: number;
  decodeMs: number;
};
type CameraSettings = {
  width: number;
  height: number;
  frameRate: number;
};
type ScanMetrics = {
  deliveredFps: number;
  scannerFps: number;
  decodeP50: number;
  decodeP95: number;
};
type ScanPurpose = "qr" | "password" | "pubkey";

function updateRollingRate(samples: RateSample[], bytes: number) {
  const now = performance.now();
  samples.push({ at: now, bytes });
  while (samples.length > 1 && now - samples[0].at > 4000) samples.shift();
  const elapsed = Math.max(750, now - samples[0].at);
  const total = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  return (total * 1000) / elapsed;
}

function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "…";
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  const minutes = seconds / 60;
  return `${minutes >= 10 ? Math.ceil(minutes) : minutes.toFixed(1)} min`;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

export function ScannerClient() {
  const { t, lang } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanModeRef = useRef<ScanMode>("single");
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const receiverRef = useRef<ReceiverSession | undefined>(undefined);
  const scanningRef = useRef(false);
  const completingRef = useRef(false);
  const downloadUrlsRef = useRef<string[]>([]);
  const scanStartedAtRef = useRef(0);
  const lastQrAtRef = useRef(0);
  const qrReadsRef = useRef(0);
  const acceptedFramesRef = useRef(0);
  const missedExposuresRef = useRef(0);
  const decodeFailuresRef = useRef(0);
  const rateSamplesRef = useRef<RateSample[]>([]);
  const deliverySamplesRef = useRef<DeliverySample[]>([]);
  const scanPerformanceRef = useRef<ScanPerformanceSample[]>([]);
  const lastPresentedFramesRef = useRef(0);
  const lastMetricsUpdateRef = useRef(0);
  const pendingPayloadsRef = useRef<Uint8Array[]>([]);
  const [state, setState] = useState<ScanState>("idle");
  const [scanMode, setScanMode] = useState<ScanMode>("single");
  const [scanPurpose, setScanPurpose] = useState<ScanPurpose>("qr");
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState(0);
  const [qrReads, setQrReads] = useState(0);
  const [missedExposures, setMissedExposures] = useState(0);
  const [badFrames, setBadFrames] = useState(0);
  const [opticalRate, setOpticalRate] = useState(0);
  const [incoming, setIncoming] = useState<IncomingMeta>();
  const [recoveredFiles, setRecoveredFiles] = useState<RecoveredFile[]>([]);
  const [burnAfterReading, setBurnAfterReading] = useState(false);
  const [signVerified, setSignVerified] = useState(false);
  const [signerName, setSignerName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [guidance, setGuidance] = useState(
    "ثبّت الكود الكامل داخل الزوايا الأربع.",
  );
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>();
  const [scanMetrics, setScanMetrics] = useState<ScanMetrics>({
    deliveredFps: 0,
    scannerFps: 0,
    decodeP50: 0,
    decodeP95: 0,
  });
  const [pendingDecryption, setPendingDecryption] =
    useState<PendingDecryption>();
  const [promptPassword, setPromptPassword] = useState("");
  const [promptError, setPromptError] = useState("");
  const [resumeNote, setResumeNote] = useState("");
  const [signatureReview, setSignatureReview] =
    useState<SignatureReview | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [handsFreeTip, setHandsFreeTip] = useState(false);
  const [stability, setStability] = useState<{
    stable: boolean;
    successRate: number;
    attempts: number;
  }>({
    stable: false,
    successRate: 0,
    attempts: 0,
  });
  const stabilityTrackerRef = useRef(new StabilityTracker());
  const releaseWakeLockRef = useRef<(() => void) | null>(null);
  const scanFramesSinceStabilityUpdateRef = useRef(0);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    releaseWakeLockRef.current?.();
    releaseWakeLockRef.current = null;
  }, []);

  const revokeDownloadUrls = useCallback(() => {
    for (const url of downloadUrlsRef.current) URL.revokeObjectURL(url);
    downloadUrlsRef.current = [];
    setRecoveredFiles([]);
  }, []);

  const chooseScanMode = (nextMode: ScanMode) => {
    scanModeRef.current = nextMode;
    setScanMode(nextMode);
    setGuidance(
      nextMode === "dual"
        ? t("scan.guide.dualInitial")
        : t("scan.guide.initial"),
    );
  };

  const finalizeAndSave = useCallback(
    async (
      recoveredFiles: RecoveredFile[],
      options: {
        burnAfterReading: boolean;
        signed: boolean;
        signerName: string | null;
        verified: boolean;
        encrypted: boolean;
        fileCount: number;
        originalSize: number;
      },
    ) => {
      const urls: string[] = [];
      const names: string[] = [];
      for (const file of recoveredFiles) {
        const blobPart = new Uint8Array(file.bytes).buffer as BlobPart;
        const url = URL.createObjectURL(
          new Blob([blobPart], { type: file.mime }),
        );
        urls.push(url);
        names.push(file.name);
      }
      revokeDownloadUrls();
      downloadUrlsRef.current = urls;
      setRecoveredFiles(recoveredFiles);
      setBurnAfterReading(options.burnAfterReading);
      setSignVerified(options.verified);
      setSignerName(options.signerName);
      setProgress(1);
      setGuidance(t("scan.guide.safeToSave"));
      setState("complete");
      stopCamera();
      navigator.vibrate?.([80, 40, 120]);

      await addHistoryEntry({
        name: names[0] ?? "transfer",
        size: options.originalSize,
        fileCount: options.fileCount,
        time: Date.now(),
        encrypted: options.encrypted,
        signed: options.signed,
        verified: options.verified,
      });

      // إشعار إتمام النقل (اهتزاز + صوت + إشعار نظام) — للمستخدم الذي ترك الجهاز
      notifyTransferComplete(names[0] ?? "file");
      setStability({ stable: false, successRate: 0, attempts: 0 });
      stabilityTrackerRef.current.reset();
    },
    [revokeDownloadUrls, stopCamera, t],
  );

  const finishTransfer = useCallback(
    async (
      container: Uint8Array,
      session: ReceiverSession,
      password?: string,
    ) => {
      if (completingRef.current) return;
      completingRef.current = true;
      try {
        setGuidance(
          session.compressed
            ? t("scan.guide.completeCompressed")
            : t("scan.guide.complete"),
        );
        if (
          container.length !== session.containerLength ||
          crc32(container) !== session.session
        ) {
          throw new Error(t("scan.error.raptorq"));
        }
        const recovered = parseOpticalContainer(container);
        if (recovered.meta.encrypted && !password) {
          // نُفرج القفل حتى تتمكن المحاولات اللاحقة (بعد إدخال كلمة المرور)
          completingRef.current = false;
          setPendingDecryption({ container, session, recovered });
          setPromptPassword("");
          setPromptError("");
          setState("password");
          stopCamera();
          return;
        }

        let transmitted = recovered.transmitted;
        if (recovered.meta.encrypted) {
          transmitted = await decryptPayload(transmitted, password as string);
        }
        const decompressed = await decompressTransfer(
          transmitted,
          recovered.meta.compression,
        );

        let files: RecoveredFile[];
        let burn = false;
        let signed = false;
        let signerName: string | null = null;
        let verified = false;

        if (isTransferPackage(decompressed)) {
          const parsed = parseTransferPackage(decompressed);
          files = parsed.files.map((file) => ({
            name: file.name,
            mime: file.mime,
            bytes: file.bytes,
          }));
          burn = parsed.burnAfterReading;
          signed = parsed.signature !== null;
          signerName = parsed.signerName;

          if (parsed.signature && parsed.signerPublicKey) {
            const canonical = buildTransferPackage({
              files: parsed.files,
              burnAfterReading: parsed.burnAfterReading,
            });
            const trusted = await getTrustedKeys();
            const fingerprint = Array.from(parsed.signerPublicKey).join(",");
            const alreadyTrusted = trusted.some(
              (key) => Array.from(key).join(",") === fingerprint,
            );
            if (alreadyTrusted) {
              const key = await importPublicKeyRaw(parsed.signerPublicKey);
              verified = await verifySignature(
                key,
                canonical,
                parsed.signature,
              );
            } else {
              // شاشة الثقة: نوقف وننتظر قرار المستخدم
              setSignatureReview({
                signerName: parsed.signerName,
                publicKeyRaw: parsed.signerPublicKey,
                fingerprint: formatPublicKeyFingerprint(parsed.signerPublicKey),
                proceed: async (trust: boolean) => {
                  setSignatureReview(null);
                  let ok = false;
                  if (trust) {
                    await addTrustedKey(parsed.signerPublicKey as Uint8Array);
                    const key = await importPublicKeyRaw(
                      parsed.signerPublicKey as Uint8Array,
                    );
                    ok = await verifySignature(
                      key,
                      canonical,
                      parsed.signature as Uint8Array,
                    );
                  }
                  completingRef.current = false;
                  await finalizeAndSave(files, {
                    burnAfterReading: burn,
                    signed,
                    signerName,
                    verified: trust ? ok : false,
                    encrypted: recovered.meta.encrypted,
                    fileCount: files.length,
                    originalSize: recovered.meta.fileSize,
                  });
                  await deleteSession(
                    sessionKey(
                      session.session,
                      session.containerLength,
                      session.symbolSize,
                    ),
                  );
                },
              });
              setState("signature-review");
              stopCamera();
              return;
            }
          }
        } else {
          // المسار الكلاسيكي: ملف واحد
          files = [
            {
              name: recovered.meta.filename,
              mime: recovered.meta.mime,
              bytes: decompressed,
            },
          ];
          if (
            decompressed.length !== recovered.meta.fileSize ||
            crc32(decompressed) !== recovered.meta.fileCrc
          ) {
            throw new Error(t("scan.error.checksum"));
          }
        }

        completingRef.current = false;
        await finalizeAndSave(files, {
          burnAfterReading: burn,
          signed,
          signerName,
          verified: signed ? verified : true,
          encrypted: recovered.meta.encrypted,
          fileCount: files.length,
          originalSize: recovered.meta.fileSize,
        });
        await deleteSession(
          sessionKey(
            session.session,
            session.containerLength,
            session.symbolSize,
          ),
        );
      } catch (cause) {
        completingRef.current = false;
        setState("error");
        setError(
          cause instanceof Error ? cause.message : t("scan.error.verify"),
        );
        stopCamera();
        // نُعيد الرمي حتى يعرف المتصل (نافذة كلمة المرور) بسبب الفشل
        throw cause;
      }
    },
    [finalizeAndSave, stopCamera, t],
  );

  const submitPassword = useCallback(async () => {
    const pending = pendingDecryption;
    if (!pending) return;
    setPromptError("");
    try {
      await finishTransfer(pending.container, pending.session, promptPassword);
      setPendingDecryption(undefined);
    } catch (cause) {
      // إبقاء النافذة مع عرض سبب الفشل (كلمة مرور خاطئة مثلاً)
      // ونخفي الخطأ العام حتى لا يتكرر العرض
      setError("");
      setPromptError(
        cause instanceof Error ? cause.message : t("scan.error.verify"),
      );
      setState("password");
    }
  }, [finishTransfer, pendingDecryption, promptPassword, t]);

  const cancelPassword = useCallback(() => {
    setPendingDecryption(undefined);
    setPromptPassword("");
    setPromptError("");
    setState("idle");
    setGuidance(t("scan.guide.decryptCancelled"));
  }, [t]);

  const cancelSignatureReview = useCallback(() => {
    setSignatureReview(null);
    setState("idle");
    setGuidance(t("scan.guide.decryptCancelled"));
  }, [t]);

  const acceptQrBytes = useCallback(
    async (bytes: Uint8Array) => {
      qrReadsRef.current += 1;
      lastQrAtRef.current = performance.now();
      setQrReads(qrReadsRef.current);

      // معالجة نصوص QR (كلمة المرور / المفتاح العام) قبل إطارات QF4
      let textPayload: string | null = null;
      try {
        textPayload = new TextDecoder().decode(bytes);
      } catch {
        textPayload = null;
      }

      if (textPayload?.startsWith("QFPW:")) {
        const password = textPayload.slice(5);
        if (scanPurpose === "password" || state === "password") {
          setPromptPassword(password);
          setPromptError("");
          setScanPurpose("qr");
          setGuidance(t("scan.passwordPlaceholder"));
          stopCamera();
          return;
        }
      }
      if (textPayload?.startsWith("QFPUB:")) {
        const raw = decodePublicKey(textPayload);
        if (raw && scanPurpose === "pubkey") {
          await addTrustedKey(raw);
          setScanPurpose("qr");
          setGuidance(t("scan.signTrust"));
          stopCamera();
          return;
        }
      }

      if (scanPurpose !== "qr") {
        // وضع مسح نصي: أي إطار QF4 يُتجاهل حتى نقرأ النص المطلوب
        return;
      }

      let frame;
      try {
        frame = parseOpticalFrame(bytes);
      } catch {
        if (textPayload?.startsWith("QF2") || textPayload?.startsWith("QF3")) {
          setGuidance(t("scan.guide.oldSender"));
          return;
        }
        setBadFrames((current) => current + 1);
        setGuidance(t("scan.guide.badFrame"));
        return;
      }

      let receiver = receiverRef.current;
      if (!receiver) {
        const { RaptorQWasmDecoder } =
          await import("@raptorqr/core/fec/raptorq_wasm");
        const decoder = await RaptorQWasmDecoder.create(
          frame.containerLength,
          frame.symbolSize,
        );
        const seen = new Set<string>();
        let baseline = 0;
        let replayedDecoded: Uint8Array | null = null;
        const key = sessionKey(
          frame.session,
          frame.containerLength,
          frame.symbolSize,
        );
        const stored = await loadSession(key);
        if (
          stored &&
          stored.payloads.length > 0 &&
          stored.containerLength === frame.containerLength &&
          stored.symbolSize === frame.symbolSize
        ) {
          baseline = stored.payloads.length;
          for (const payload of stored.payloads) {
            if (payload.length < 4) continue;
            seen.add(payloadSymbolKey(frame.session, payload));
            const decoded = decoder.push(payload);
            if (decoded && !replayedDecoded) replayedDecoded = decoded;
          }
          setResumeNote(t("scan.resumeNote", { n: baseline.toLocaleString() }));
        } else {
          setResumeNote("");
        }
        receiver = {
          session: frame.session,
          containerLength: frame.containerLength,
          originalSize: frame.originalSize,
          compressed: frame.compressed,
          symbolSize: frame.symbolSize,
          sourcePacketCount: Math.max(
            1,
            Math.ceil(frame.containerLength / (frame.symbolSize - 4)),
          ),
          decoder,
          seen,
        };
        receiverRef.current = receiver;
        acceptedFramesRef.current = baseline;
        setFrames(baseline);
        setIncoming({
          session: receiver.session,
          containerLength: receiver.containerLength,
          originalSize: receiver.originalSize,
          compressed: receiver.compressed,
          symbolSize: receiver.symbolSize,
          sourcePacketCount: receiver.sourcePacketCount,
        });
        setGuidance(
          baseline > 0 ? t("scan.guide.lockedResume") : t("scan.guide.locked"),
        );
        setState("receiving");
        if (replayedDecoded) {
          await finishTransfer(replayedDecoded, receiver);
          return;
        }
      }

      if (
        frame.session !== receiver.session ||
        frame.containerLength !== receiver.containerLength ||
        frame.symbolSize !== receiver.symbolSize
      ) {
        setGuidance(t("scan.guide.different"));
        return;
      }

      const key = raptorPacketKey(frame);
      if (receiver.seen.has(key)) {
        setGuidance(t("scan.guide.duplicate"));
        return;
      }
      receiver.seen.add(key);
      acceptedFramesRef.current += 1;
      const accepted = acceptedFramesRef.current;
      const sourceBytes = Math.max(1, frame.symbolSize - 4);
      const rate = updateRollingRate(rateSamplesRef.current, sourceBytes);
      const estimatedProgress = Math.min(
        0.99,
        accepted / (receiver.sourcePacketCount + 2),
      );
      setFrames(accepted);
      setOpticalRate(rate);
      setProgress(estimatedProgress);
      setGuidance(
        frame.symbolSize > 2200
          ? t("scan.guide.highDensity")
          : t("scan.guide.lockedSymbol"),
      );
      setState("receiving");
      if (pendingPayloadsRef.current.length < MAX_SYMBOLS_STORED) {
        pendingPayloadsRef.current.push(frame.payload);
      }

      const decoded = receiver.decoder.push(frame.payload);
      if (decoded) await finishTransfer(decoded, receiver);
    },
    [finishTransfer, scanPurpose, state, stopCamera, t],
  );

  // حفظ الرموز المستلمة دورياً في IndexedDB لتمكين الاستئناف.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const batch = pendingPayloadsRef.current;
      if (batch.length === 0) return;
      pendingPayloadsRef.current = [];
      const receiver = receiverRef.current;
      if (!receiver) return;
      const key = sessionKey(
        receiver.session,
        receiver.containerLength,
        receiver.symbolSize,
      );
      try {
        const existing = (await loadSession(key)) ?? {
          key,
          session: receiver.session,
          containerLength: receiver.containerLength,
          symbolSize: receiver.symbolSize,
          originalSize: receiver.originalSize,
          compressed: receiver.compressed,
          payloads: [] as Uint8Array[],
          updatedAt: Date.now(),
        };
        const seen = new Set(
          existing.payloads.map((payload) =>
            payloadSymbolKey(receiver.session, payload),
          ),
        );
        const fresh = batch.filter(
          (payload) => !seen.has(payloadSymbolKey(receiver.session, payload)),
        );
        await saveSession({
          ...existing,
          payloads: existing.payloads.concat(fresh).slice(-MAX_SYMBOLS_STORED),
          updatedAt: Date.now(),
        });
        await evictOldSessions(2);
      } catch {
        // التخزين للاستئناف اختياري؛ لا نوقف المسح عند فشله.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  /** يحدّث حالة شارة الاستقرار كل بضع محاولات (تجنب إعادة رسم متكررة). */
  const maybeUpdateStability = () => {
    if (scanFramesSinceStabilityUpdateRef.current % 4 === 0) {
      const current = stabilityTrackerRef.current.state;
      setStability({
        stable: current.stable,
        successRate: current.successRate,
        attempts: current.attempts,
      });
    }
    scanFramesSinceStabilityUpdateRef.current += 1;
  };

  const scanVideo = useCallback(
    function scanVideoFrame(metadata?: VideoFrameMetadataLike) {
      if (!scanningRef.current) return;
      const callbackAt = performance.now();
      const reportedFrames = metadata?.presentedFrames;
      const presentedFrames =
        typeof reportedFrames === "number" &&
        reportedFrames > lastPresentedFramesRef.current
          ? reportedFrames
          : lastPresentedFramesRef.current + 1;
      lastPresentedFramesRef.current = presentedFrames;
      const deliverySamples = deliverySamplesRef.current;
      deliverySamples.push({ at: callbackAt, frames: presentedFrames });
      while (
        deliverySamples.length > 2 &&
        callbackAt - deliverySamples[0].at > 3500
      ) {
        deliverySamples.shift();
      }

      let attempted = false;
      let decodeMs = 0;
      const runScan = async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (
          !video ||
          !canvas ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          video.videoWidth === 0 ||
          video.videoHeight === 0
        ) {
          return;
        }

        const dualMode = scanModeRef.current === "dual";
        const availableWidth = video.videoWidth * 0.96;
        const availableHeight = video.videoHeight * 0.96;
        const sourceWidth = Math.floor(
          dualMode
            ? Math.min(availableWidth, availableHeight * 2)
            : Math.min(availableWidth, availableHeight),
        );
        const sourceHeight = dualMode
          ? Math.floor(sourceWidth / 2)
          : sourceWidth;
        const sourceX = Math.floor((video.videoWidth - sourceWidth) / 2);
        const sourceY = Math.floor((video.videoHeight - sourceHeight) / 2);
        const robustAttempt = decodeFailuresRef.current % 6 === 5;
        const highDensity = (receiverRef.current?.symbolSize ?? 0) > 2200;
        const scanWidth = Math.min(
          dualMode
            ? highDensity
              ? 1800
              : robustAttempt
                ? 1680
                : 1440
            : highDensity
              ? 1280
              : robustAttempt
                ? 1120
                : 960,
          sourceWidth,
        );
        const scanHeight = dualMode
          ? Math.max(1, Math.floor(scanWidth / 2))
          : scanWidth;
        canvas.width = scanWidth;
        canvas.height = scanHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.imageSmoothingEnabled = false;
        context.drawImage(
          video,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          scanWidth,
          scanHeight,
        );

        const image = context.getImageData(0, 0, scanWidth, scanHeight);
        const { scanRawQr, scanRawQrs } = await import("@/lib/qr-scanner");
        attempted = true;
        const decodeStartedAt = performance.now();
        let decodedFrames: Uint8Array[];
        try {
          if (dualMode) {
            decodedFrames = await scanRawQrs(image, robustAttempt, 2);
          } else {
            const decoded = await scanRawQr(image, robustAttempt);
            decodedFrames = decoded ? [decoded] : [];
          }
        } finally {
          decodeMs = performance.now() - decodeStartedAt;
        }

        if (decodedFrames.length === 0) {
          decodeFailuresRef.current += 1;
          missedExposuresRef.current += 1;
          if (missedExposuresRef.current % 5 === 0) {
            setMissedExposures(missedExposuresRef.current);
          }
          stabilityTrackerRef.current.push(false);
          maybeUpdateStability();
          return;
        }
        decodeFailuresRef.current = 0;
        stabilityTrackerRef.current.push(true);
        maybeUpdateStability();
        for (const decoded of decodedFrames) {
          await acceptQrBytes(decoded);
        }
      };

      void runScan()
        .catch(() => {
          decodeFailuresRef.current += 1;
          missedExposuresRef.current += 1;
        })
        .finally(() => {
          if (!scanningRef.current) return;
          const finishedAt = performance.now();
          if (attempted) {
            const performanceSamples = scanPerformanceRef.current;
            performanceSamples.push({ at: finishedAt, decodeMs });
            while (
              performanceSamples.length > 2 &&
              finishedAt - performanceSamples[0].at > 3500
            ) {
              performanceSamples.shift();
            }

            if (finishedAt - lastMetricsUpdateRef.current >= 500) {
              const firstDelivery = deliverySamples[0];
              const lastDelivery = deliverySamples[deliverySamples.length - 1];
              const deliveryElapsed =
                lastDelivery && firstDelivery
                  ? lastDelivery.at - firstDelivery.at
                  : 0;
              const deliveredFps =
                deliveryElapsed > 0
                  ? ((lastDelivery.frames - firstDelivery.frames) * 1000) /
                    deliveryElapsed
                  : 0;
              const firstScan = performanceSamples[0];
              const lastScan =
                performanceSamples[performanceSamples.length - 1];
              const scanElapsed =
                lastScan && firstScan ? lastScan.at - firstScan.at : 0;
              const scannerFps =
                scanElapsed > 0
                  ? ((performanceSamples.length - 1) * 1000) / scanElapsed
                  : 0;
              const decodeValues = performanceSamples.map(
                (sample) => sample.decodeMs,
              );
              setScanMetrics({
                deliveredFps,
                scannerFps,
                decodeP50: percentile(decodeValues, 0.5),
                decodeP95: percentile(decodeValues, 0.95),
              });
              lastMetricsUpdateRef.current = finishedAt;
            }
          }

          const video = videoRef.current as VideoWithFrameCallback | null;
          if (video?.requestVideoFrameCallback) {
            video.requestVideoFrameCallback((_now, nextMetadata) =>
              scanVideoFrame(nextMetadata),
            );
          } else {
            window.requestAnimationFrame(() => scanVideoFrame());
          }
        });
    },
    [acceptQrBytes],
  );

  const listCameras = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "videoinput");
    } catch {
      return [];
    }
  }, []);

  const startCamera = useCallback(
    async (purpose: ScanPurpose = "qr") => {
      setError("");
      setScanPurpose(purpose);
      setGuidance(
        purpose === "qr"
          ? scanModeRef.current === "dual"
            ? t("scan.guide.dualInitial")
            : t("scan.guide.initial")
          : t("scan.guide.signScan"),
      );
      setState("starting");
      receiverRef.current = undefined;
      completingRef.current = false;
      qrReadsRef.current = 0;
      acceptedFramesRef.current = 0;
      missedExposuresRef.current = 0;
      decodeFailuresRef.current = 0;
      rateSamplesRef.current = [];
      deliverySamplesRef.current = [];
      scanPerformanceRef.current = [];
      lastPresentedFramesRef.current = 0;
      lastMetricsUpdateRef.current = 0;
      lastQrAtRef.current = 0;
      scanStartedAtRef.current = performance.now();
      pendingPayloadsRef.current = [];
      setIncoming(undefined);
      setProgress(0);
      setFrames(0);
      setQrReads(0);
      setMissedExposures(0);
      setBadFrames(0);
      setOpticalRate(0);
      setTorchOn(false);
      setCameraSettings(undefined);
      setResumeNote("");
      setPendingDecryption(undefined);
      setPromptPassword("");
      setPromptError("");
      setScanMetrics({
        deliveredFps: 0,
        scannerFps: 0,
        decodeP50: 0,
        decodeP95: 0,
      });
      if (downloadUrlsRef.current.length > 0) {
        revokeDownloadUrls();
      }

      // تلميح «اليد الحرة» مرة واحدة (يُحفظ محلياً)
      try {
        if (!localStorage.getItem("qrferry-handsfree-seen")) {
          localStorage.setItem("qrferry-handsfree-seen", "1");
          setHandsFreeTip(true);
        }
      } catch {
        // تجاهل
      }
      // منع نوم الشاشة أثناء النشاط
      releaseWakeLockRef.current = await acquireScreenWakeLock();

      try {
        const devices = await listCameras();
        setCameraDevices(devices);
        const decoderLoad = import("@/lib/qr-scanner").then(
          ({ prepareQrScanner }) => prepareQrScanner(),
        );
        const videoConstraints: MediaTrackConstraints = {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, min: 24 },
        };
        if (selectedCamera && selectedCamera !== "auto") {
          videoConstraints.deviceId = { exact: selectedCamera };
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        });
        await decoderLoad;
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        setCameraSettings({
          width: settings.width ?? 0,
          height: settings.height ?? 0,
          frameRate: settings.frameRate ?? 0,
        });
        const capabilities =
          track.getCapabilities?.() as MediaTrackCapabilities & {
            focusMode?: string[];
            torch?: boolean;
          };
        setTorchAvailable(Boolean(capabilities?.torch));
        if (capabilities?.focusMode?.includes("continuous")) {
          await track
            .applyConstraints({
              advanced: [
                { focusMode: "continuous" } as MediaTrackConstraintSet,
              ],
            })
            .catch(() => undefined);
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        scanningRef.current = true;
        setState("scanning");
        const video = videoRef.current as VideoWithFrameCallback | null;
        if (video?.requestVideoFrameCallback) {
          video.requestVideoFrameCallback((_now, metadata) =>
            scanVideo(metadata),
          );
        } else {
          window.requestAnimationFrame(() => scanVideo());
        }
      } catch (cause) {
        stopCamera();
        setState("error");
        const name = cause instanceof DOMException ? cause.name : "";
        setError(
          name === "NotAllowedError"
            ? t("scan.error.cameraBlocked")
            : t("scan.error.cameraStart"),
        );
      }
    },
    [listCameras, revokeDownloadUrls, scanVideo, selectedCamera, stopCamera, t],
  );

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!scanningRef.current || acceptedFramesRef.current > 0) return;
      const now = performance.now();
      if (lastQrAtRef.current > 0 && now - lastQrAtRef.current < 3000) return;
      const elapsed = now - scanStartedAtRef.current;
      if (elapsed > 8000) {
        setGuidance(
          scanModeRef.current === "dual"
            ? t("scan.guide.noFrame8sDual")
            : t("scan.guide.noFrame8s"),
        );
      } else if (elapsed > 4000) {
        setGuidance(
          scanModeRef.current === "dual"
            ? t("scan.guide.noFrame4sDual")
            : t("scan.guide.noFrame4s"),
        );
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [t]);

  useEffect(() => {
    return () => {
      stopCamera();
      revokeDownloadUrls();
    };
  }, [revokeDownloadUrls, stopCamera]);

  // تنزيل كل الملفات كـ ZIP
  const downloadAllZip = useCallback(async () => {
    if (recoveredFiles.length === 0) return;
    const { zipSync } = await import("fflate");
    const entries: Record<string, Uint8Array> = {};
    for (const file of recoveredFiles) {
      entries[file.name] = new Uint8Array(file.bytes);
    }
    const zipData = zipSync(entries, { level: 6 });
    const url = URL.createObjectURL(
      new Blob([zipData], { type: "application/zip" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `qrferry-${Date.now()}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [recoveredFiles]);

  const complete = state === "complete";
  const active =
    state === "scanning" || state === "receiving" || state === "starting";
  const compressionRatio =
    incoming && incoming.containerLength > 0
      ? incoming.originalSize / incoming.containerLength
      : 1;
  const effectiveRate = opticalRate * compressionRatio;
  const recoveredBytes = incoming
    ? Math.min(
        incoming.containerLength,
        frames * Math.max(1, incoming.symbolSize - 4),
      )
    : 0;
  const etaSeconds =
    incoming && opticalRate > 0
      ? (incoming.containerLength - recoveredBytes) / opticalRate
      : Number.POSITIVE_INFINITY;
  const compressionPercent =
    incoming && incoming.originalSize > 0
      ? Math.max(
          0,
          Math.round(
            (1 - incoming.containerLength / incoming.originalSize) * 100,
          ),
        )
      : 0;

  const transferStats = (
    <>
      {incoming ? (
        <>
          <div className="rate-panel" aria-live="polite">
            <div>
              <span>{t("scan.rate.effective")}</span>
              <strong>
                {effectiveRate > 0 ? formatRate(effectiveRate) : "—"}
              </strong>
              <small>
                {incoming?.compressed
                  ? `${formatRate(opticalRate)} ${t("scan.rate.optical", { p: compressionPercent })}`
                  : `${formatRate(opticalRate)} ${t("scan.rate.opticalOnly")}`}
              </small>
            </div>
            <div>
              <span>{t("scan.rate.remaining")}</span>
              <strong>
                {complete ? t("scan.rate.complete") : formatEta(etaSeconds)}
              </strong>
              <small>
                {incoming
                  ? `${formatBytes(recoveredBytes)} ${t("scan.rate.of")} ${formatBytes(incoming.containerLength)} ${t("scan.rate.encoded")}`
                  : t("scan.rate.waiting")}
              </small>
            </div>
          </div>
        </>
      ) : null}

      {incoming ? (
        <div className="incoming-file">
          <span className="file-glyph" aria-hidden="true">
            ↓
          </span>
          <div>
            <strong>
              {incoming.compressed ? t("scan.incoming") : t("scan.incoming")}
            </strong>
            <span>
              {formatBytes(incoming.originalSize)}
              {incoming.compressed
                ? ` · ${t("scan.incomingCompressed", { p: compressionPercent })}`
                : ""}
              {" · "}
              {frames.toLocaleString()} / ~
              {incoming.sourcePacketCount.toLocaleString()} {t("scan.symbols")}
            </span>
          </div>
          <b>RQ</b>
        </div>
      ) : null}
    </>
  );

  return (
    <main
      className={`transfer-page scanner-page ws-state-${state} ${complete ? "is-complete" : ""} ${state === "password" || state === "signature-review" ? "needs-review" : ""}`}
    >
      <section className="workspace-intro">
        <h1>{complete ? t("scan.h1.complete") : t("scan.h1.ready")}</h1>
        <p>
          {complete
            ? t("scan.intro.complete")
            : scanMode === "dual"
              ? t("scan.intro.dual")
              : t("scan.intro.single")}
        </p>
      </section>

      <section className="scanner-shell">
        <div className="camera-card">
          <div className="step-heading">
            <span>01</span>
            <h2>{lang === "ar" ? "الكاميرا" : "Camera"}</h2>
          </div>
          <div
            className={`camera-view ${scanMode} ${active ? "active" : ""} ${complete ? "complete" : ""}`}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="معاينة الكاميرا"
            />
            <canvas ref={canvasRef} hidden />
            <div className="scan-reticle" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            {!active &&
            !complete &&
            state !== "password" &&
            state !== "signature-review" ? (
              <div className="camera-empty">
                <Camera
                  size={48}
                  strokeWidth={1.5}
                  className="camera-icon"
                  aria-hidden="true"
                />
                <strong>{t("scan.cameraOff")}</strong>
              </div>
            ) : null}
            {state === "starting" ? (
              <div className="camera-loading">{t("scan.loading")}</div>
            ) : null}
            {complete ? (
              <div className="complete-mark" aria-hidden="true">
                <Check size={44} strokeWidth={3} />
              </div>
            ) : null}
            {torchAvailable && active ? (
              <button
                className="torch-button"
                type="button"
                onClick={toggleTorch}
              >
                {torchOn ? t("scan.torchOn") : t("scan.torchOff")}
              </button>
            ) : null}
          </div>

          {!complete ? (
            <div className="camera-actions">
              {" "}
              <button
                className="primary-action"
                type="button"
                disabled={
                  state === "starting" ||
                  state === "password" ||
                  state === "signature-review"
                }
                onClick={
                  active
                    ? () => {
                        stopCamera();
                        setState("idle");
                        setGuidance(t("scan.guide.cameraStopped"));
                      }
                    : () => void startCamera("qr")
                }
              >
                <span aria-hidden="true">{active ? "■" : "◎"}</span>
                {state === "starting"
                  ? t("scan.loadingBtn")
                  : active
                    ? t("scan.stop")
                    : t("scan.start")}
              </button>
            </div>
          ) : null}
          <WorkspaceDisclosure
            className="camera-settings"
            title={lang === "ar" ? "إعدادات الكاميرا" : "Camera settings"}
          >
            <div
              className="scan-mode-picker"
              role="radiogroup"
              aria-label="تخطيط الماسح"
            >
              <button
                type="button"
                role="radio"
                aria-checked={scanMode === "single"}
                className={scanMode === "single" ? "selected" : ""}
                disabled={active}
                onClick={() => chooseScanMode("single")}
              >
                {t("scan.mode.single")}
                <small>{t("scan.mode.singleSub")}</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scanMode === "dual"}
                className={scanMode === "dual" ? "selected" : ""}
                disabled={active}
                onClick={() => chooseScanMode("dual")}
              >
                {t("scan.mode.dual")}
                <small>{t("scan.mode.dualSub")}</small>
              </button>
            </div>

            {cameraDevices.length > 1 && !active ? (
              <div className="camera-picker">
                <label htmlFor="camera-select">{t("scan.cameraSelect")}</label>
                <select
                  id="camera-select"
                  value={selectedCamera}
                  onChange={(event) => setSelectedCamera(event.target.value)}
                >
                  <option value="auto">{t("scan.cameraAuto")}</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `${t("scan.cameraSelect")} ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </WorkspaceDisclosure>
        </div>

        <div className="receive-card">
          <div className="step-heading">
            <span>02</span>
            <h2>
              {complete
                ? lang === "ar"
                  ? "ملفاتك جاهزة"
                  : "Your files are ready"
                : lang === "ar"
                  ? "حالة الاستقبال"
                  : "Receive status"}
            </h2>
          </div>
          <div className="receive-status">
            <span
              className={`pulse-dot ${active ? "live" : ""}`}
              aria-hidden="true"
            />
            <strong>
              {state === "error"
                ? lang === "ar"
                  ? "تعذّر الاستقبال"
                  : "Reception failed"
                : state === "starting"
                  ? t("scan.loadingBtn")
                  : state === "receiving"
                    ? t("scan.status.receiving")
                    : state === "scanning"
                      ? t("scan.status.searching")
                      : state === "password"
                        ? t("scan.status.password")
                        : state === "signature-review"
                          ? t("scan.signUntrusted")
                          : complete
                            ? t("scan.status.verified")
                            : t("scan.status.ready")}
            </strong>
            <b>{Math.round(progress * 100)}%</b>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="تقدّم استرداد الملف"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </div>

          {handsFreeTip && active ? (
            <p className="resume-note handsfree-tip" role="status">
              <Bird size={14} aria-hidden="true" /> {t("scan.handsfreeTip")}
            </p>
          ) : null}

          {active ? (
            <div
              className={`stability-badge ${stability.stable ? "stable" : "unstable"}`}
              data-testid="stability-badge"
              aria-live="polite"
            >
              {stability.stable ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                <span aria-hidden="true">✱</span>
              )}{" "}
              {stability.stable
                ? t("scan.stableBadge")
                : t("scan.unstableBadge")}
            </div>
          ) : null}

          {resumeNote && !complete ? (
            <p className="resume-note" role="status">
              {resumeNote}
            </p>
          ) : null}

          {state === "password" && pendingDecryption ? (
            <div className="password-prompt">
              <strong>{t("scan.passwordTitle")}</strong>
              <p>{t("scan.passwordBody")}</p>
              <input
                className="password-input"
                type="password"
                dir="ltr"
                autoComplete="off"
                autoFocus
                value={promptPassword}
                placeholder={t("scan.passwordPlaceholder")}
                onChange={(event) => setPromptPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitPassword();
                }}
              />
              {promptError ? (
                <p className="prompt-error" role="alert">
                  {promptError}
                </p>
              ) : null}
              <div className="prompt-actions">
                <button type="button" onClick={() => void submitPassword()}>
                  {t("scan.passwordDecrypt")}
                </button>
                <button type="button" onClick={cancelPassword}>
                  {t("scan.passwordCancel")}
                </button>
              </div>
              <button
                type="button"
                className="mini-btn"
                onClick={() => void startCamera("password")}
              >
                {t("scan.passwordScanQr")}
              </button>
            </div>
          ) : null}

          {state === "signature-review" && signatureReview ? (
            <div className="sign-trust-panel">
              <strong>{t("scan.signUntrusted")}</strong>
              <p>
                {t("scan.signFrom", {
                  name: signatureReview.signerName ?? "?",
                })}
                <br />
                {signatureReview.fingerprint}
              </p>
              <p>{t("scan.signBody")}</p>
              <div className="trust-actions">
                <button
                  type="button"
                  onClick={() => signatureReview.proceed(true)}
                >
                  {t("scan.signTrust")}
                </button>
                <button
                  type="button"
                  onClick={() => signatureReview.proceed(false)}
                >
                  {t("scan.signReject")}
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={cancelSignatureReview}
                >
                  {t("scan.passwordCancel")}
                </button>
              </div>
            </div>
          ) : null}

          {complete && signVerified && signerName ? (
            <p className="sign-verified-note" role="status">
              {t("scan.signVerified", { name: signerName })}
            </p>
          ) : null}
          {complete && burnAfterReading ? (
            <p className="resume-note" role="status">
              {t("scan.burnNotice")}
            </p>
          ) : null}

          {!complete ? transferStats : null}

          <WorkspaceDisclosure
            className="scanner-details"
            title={lang === "ar" ? "التفاصيل التقنية" : "Technical details"}
          >
            {complete ? transferStats : null}
            <div
              className="scan-diagnostics channel-diagnostics"
              aria-label="أداء الكاميرا والمفكك لحظياً"
            >
              <span>
                <b>
                  {cameraSettings?.frameRate
                    ? cameraSettings.frameRate.toFixed(0)
                    : "—"}{" "}
                  fps
                </b>
                {t("scan.diag.negotiated")}
              </span>
              <span>
                <b>
                  {scanMetrics.deliveredFps
                    ? scanMetrics.deliveredFps.toFixed(1)
                    : "—"}{" "}
                  fps
                </b>
                {t("scan.diag.delivered")}
              </span>
              <span>
                <b>
                  {scanMetrics.scannerFps
                    ? scanMetrics.scannerFps.toFixed(1)
                    : "—"}{" "}
                  fps
                </b>
                {t("scan.diag.scanned")}
              </span>
              <span>
                <b>
                  {scanMetrics.decodeP50
                    ? `${scanMetrics.decodeP50.toFixed(0)} / ${scanMetrics.decodeP95.toFixed(0)} ms`
                    : "—"}
                </b>
                {t("scan.diag.decode")}
              </span>
            </div>
            <div className="scan-diagnostics">
              <span>
                <b>{qrReads}</b> {t("scan.diag.msg")}
              </span>
              <span>
                <b>{frames}</b> {t("scan.diag.unique")}
              </span>
              <span>
                <b>{missedExposures}</b> {t("scan.diag.missed")}
              </span>
              <span>
                <b>{badFrames}</b> {t("scan.diag.rejected")}
              </span>
            </div>
          </WorkspaceDisclosure>
          {active ? (
            <p className="scan-hint" role="status">
              {guidance}
            </p>
          ) : null}

          {error ? (
            <>
              <p className="error-message" role="alert">
                {error}
              </p>
              <button
                type="button"
                className="primary-action camera-retry"
                onClick={() => void startCamera("qr")}
              >
                {lang === "ar" ? "إعادة المحاولة" : "Try again"}
              </button>
            </>
          ) : null}

          {complete && recoveredFiles.length > 0 ? (
            <>
              <div className="received-files">
                {recoveredFiles.map((file, index) => (
                  <div className="file-row" key={`${file.name}-${index}`}>
                    <span className="fname">{file.name}</span>
                    <span className="fmeta">
                      {formatBytes(file.bytes.length)}
                    </span>
                    <a
                      href={downloadUrlsRef.current[index] ?? "#"}
                      download={file.name}
                      aria-label={t("scan.save", { name: file.name })}
                      onClick={() => {
                        if (burnAfterReading) {
                          setTimeout(() => revokeDownloadUrls(), 60_000);
                        }
                      }}
                    >
                      <Download size={18} aria-hidden="true" />{" "}
                      {lang === "ar" ? "تنزيل" : "Download"}
                    </a>
                  </div>
                ))}
              </div>
              {recoveredFiles.length > 1 ? (
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => void downloadAllZip()}
                >
                  <Download size={18} aria-hidden="true" />
                  {t("scan.saveAll")}
                </button>
              ) : null}
              <button
                className="link-action"
                type="button"
                onClick={() => void startCamera()}
              >
                {t("scan.scanAnother")}
              </button>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
