"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decompressTransfer } from "@/lib/compression";
import { decryptPayload } from "@/lib/encryption";
import {
  crc32,
  formatBytes,
  formatRate,
  OpticalFileMeta,
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

type ScanState =
  | "idle"
  | "starting"
  | "scanning"
  | "receiving"
  | "password"
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
type PendingDecryption = {
  container: Uint8Array;
  session: ReceiverSession;
  recovered: ReturnType<typeof parseOpticalContainer>;
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

function updateRollingRate(samples: RateSample[], bytes: number) {
  const now = performance.now();
  samples.push({ at: now, bytes });
  while (samples.length > 1 && now - samples[0].at > 4000) samples.shift();
  const elapsed = Math.max(750, now - samples[0].at);
  const total = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  return (total * 1000) / elapsed;
}

function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "جارٍ الحساب";
  if (seconds < 60) return `${Math.ceil(seconds)} ثانية`;
  const minutes = seconds / 60;
  return `${minutes >= 10 ? Math.ceil(minutes) : minutes.toFixed(1)} دقيقة`;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function ScannerClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanModeRef = useRef<ScanMode>("single");
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const receiverRef = useRef<ReceiverSession | undefined>(undefined);
  const scanningRef = useRef(false);
  const completingRef = useRef(false);
  const downloadUrlRef = useRef("");
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
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState(0);
  const [qrReads, setQrReads] = useState(0);
  const [missedExposures, setMissedExposures] = useState(0);
  const [badFrames, setBadFrames] = useState(0);
  const [opticalRate, setOpticalRate] = useState(0);
  const [incoming, setIncoming] = useState<IncomingMeta>();
  const [fileMeta, setFileMeta] = useState<OpticalFileMeta>();
  const [downloadUrl, setDownloadUrl] = useState("");
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

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
  }, []);

  const chooseScanMode = (nextMode: ScanMode) => {
    scanModeRef.current = nextMode;
    setScanMode(nextMode);
    setGuidance(
      nextMode === "dual"
        ? "أدر الهاتف أفقياً وضع الكودَين الكاملين داخل الإطار."
        : "ثبّت الكود الكامل داخل الزوايا الأربع.",
    );
  };

  const finalizeRecovered = useCallback(
    async (
      recovered: ReturnType<typeof parseOpticalContainer>,
      session: ReceiverSession,
      password?: string,
    ) => {
      let transmitted = recovered.transmitted;
      if (recovered.meta.encrypted) {
        if (!password) {
          throw new Error("هذا الملف مشفَّر وكلمة المرور مطلوبة لفكّه.");
        }
        transmitted = await decryptPayload(transmitted, password);
      }
      const bytes = await decompressTransfer(
        transmitted,
        recovered.meta.compression,
      );
      if (
        bytes.length !== recovered.meta.fileSize ||
        crc32(bytes) !== recovered.meta.fileCrc
      ) {
        throw new Error("المجموع الاختباري للملف المستعاد غير مطابق.");
      }

      const fileBytes = Uint8Array.from(bytes);
      const url = URL.createObjectURL(
        new Blob([fileBytes.buffer], { type: recovered.meta.mime }),
      );
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = url;
      setFileMeta(recovered.meta);
      setDownloadUrl(url);
      setProgress(1);
      setGuidance("فُك الضغط وتحقّق المجموع الاختباري. الملف آمن للحفظ.");
      setState("complete");
      stopCamera();
      navigator.vibrate?.([80, 40, 120]);
      await deleteSession(
        sessionKey(session.session, session.containerLength, session.symbolSize),
      );
    },
    [stopCamera],
  );

  const finishTransfer = useCallback(
    async (container: Uint8Array, session: ReceiverSession) => {
      if (completingRef.current) return;
      completingRef.current = true;
      try {
        setGuidance(
          session.compressed
            ? "اكتمل الاستقبال البصري. جارٍ فك الضغط والتحقق…"
            : "اكتمل الاستقبال البصري. جارٍ التحقق…",
        );
        if (
          container.length !== session.containerLength ||
          crc32(container) !== session.session
        ) {
          throw new Error("كائن RaptorQ المستعاد فشل في فحص المجموع.");
        }
        const recovered = parseOpticalContainer(container);
        if (recovered.meta.encrypted) {
          setPendingDecryption({ container, session, recovered });
          setPromptPassword("");
          setPromptError("");
          setState("password");
          stopCamera();
          return;
        }
        await finalizeRecovered(recovered, session);
      } catch (cause) {
        setState("error");
        setError(
          cause instanceof Error ? cause.message : "فشل التحقق من الملف.",
        );
        stopCamera();
      } finally {
        completingRef.current = false;
      }
    },
    [finalizeRecovered, stopCamera],
  );

  const submitPassword = useCallback(async () => {
    const pending = pendingDecryption;
    if (!pending) return;
    setPromptError("");
    try {
      await finalizeRecovered(pending.recovered, pending.session, promptPassword);
      setPendingDecryption(undefined);
    } catch (cause) {
      setPromptError(
        cause instanceof Error ? cause.message : "تعذّر فك التشفير.",
      );
    }
  }, [finalizeRecovered, pendingDecryption, promptPassword]);

  const cancelPassword = useCallback(() => {
    setPendingDecryption(undefined);
    setPromptPassword("");
    setPromptError("");
    setState("idle");
    setGuidance("أُلغي فك التشفير. يمكنك إعادة تشغيل الكاميرا والمحاولة لاحقاً.");
  }, []);

  const acceptQrBytes = useCallback(
    async (bytes: Uint8Array) => {
      qrReadsRef.current += 1;
      lastQrAtRef.current = performance.now();
      setQrReads(qrReadsRef.current);

      let frame;
      try {
        frame = parseOpticalFrame(bytes);
      } catch {
        const textPrefix = new TextDecoder().decode(bytes.subarray(0, 8));
        if (textPrefix.startsWith("QF2") || textPrefix.startsWith("QF3")) {
          setGuidance("يظهر مرسل QRFerry قديم. أعد تحميل شاشة الإرسال.");
          return;
        }
        setBadFrames((current) => current + 1);
        setGuidance("إطار غير مكتمل. ثبّت يدك — الإطار التالي يعوّضه.");
        return;
      }

      let receiver = receiverRef.current;
      if (!receiver) {
        const { RaptorQWasmDecoder } = await import(
          "@raptorqr/core/fec/raptorq_wasm"
        );
        const decoder = await RaptorQWasmDecoder.create(
          frame.containerLength,
          frame.symbolSize,
        );
        const seen = new Set<string>();
        let baseline = 0;
        let replayedDecoded: Uint8Array | null = null;
        const key = sessionKey(frame.session, frame.containerLength, frame.symbolSize);
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
          setResumeNote(
            `استُئنف الاستقبال من جلسة سابقة: ${baseline.toLocaleString()} رمزاً محفوظاً على هذا الجهاز.`,
          );
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
          baseline > 0
            ? "قُفل RaptorQ واستُئنف التقدم. أبقِ الهامش الأبيض الكامل ظاهراً."
            : "قُفل RaptorQ. أبقِ الهامش الأبيض الكامل ظاهراً.",
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
        setGuidance("نقل مختلف عبر كاميرا الرؤية. التزم بمرسل واحد.");
        return;
      }

      const key = raptorPacketKey(frame);
      if (receiver.seen.has(key)) {
        setGuidance("قُفلت الإشارة. بانتظار رمز RaptorQ جديد.");
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
          ? "قُفل البث عالي الكثافة. أبقِ الهاتف قريباً ومستقيماً وثابتاً تماماً."
          : "قُفلت الإشارة. RaptorQ يمتصّ الإطارات المفقودة.",
      );
      setState("receiving");
      if (pendingPayloadsRef.current.length < MAX_SYMBOLS_STORED) {
        pendingPayloadsRef.current.push(frame.payload);
      }

      const decoded = receiver.decoder.push(frame.payload);
      if (decoded) await finishTransfer(decoded, receiver);
    },
    [finishTransfer],
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
        const highDensity =
          (receiverRef.current?.symbolSize ?? 0) > 2200;
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
          return;
        }
        decodeFailuresRef.current = 0;
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
              const lastDelivery =
                deliverySamples[deliverySamples.length - 1];
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

  const startCamera = useCallback(async () => {
    setError("");
    setGuidance(
      scanModeRef.current === "dual"
        ? "أدر الهاتف أفقياً وضع الكودَين الكاملين داخل الإطار."
        : "ثبّت الكود الكامل داخل الزوايا الأربع.",
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
    setFileMeta(undefined);
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
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = "";
      setDownloadUrl("");
    }

    try {
      const decoderLoad = import("@/lib/qr-scanner").then(({ prepareQrScanner }) =>
        prepareQrScanner(),
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, min: 24 },
        },
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
      const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & {
        focusMode?: string[];
        torch?: boolean;
      };
      setTorchAvailable(Boolean(capabilities?.torch));
      if (capabilities?.focusMode?.includes("continuous")) {
        await track
          .applyConstraints({
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
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
          ? "تم حظر الوصول إلى الكاميرا. اسمح بالوصول في إعدادات المتصفح وحاول مجدداً."
          : "تعذّر تشغيل الكاميرا الخلفية. المسح بالكاميرا يحتاج HTTPS أو localhost.",
      );
    }
  }, [scanVideo, stopCamera]);

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
            ? "لم يُقرأ أي مسار. تأكد من اختيار «مسار مزدوج» على الجهازين، أدر الهاتف أفقياً، واقترب أكثر."
            : "لم يُقرأ أي إطار. استخدم وضع Robust، واقترب أكثر، وأبقِ الهامش الأبيض ظاهراً.",
        );
      } else if (elapsed > 4000) {
        setGuidance(
          scanModeRef.current === "dual"
            ? "ما زلنا نبحث. أبقِ الهامشين الأبيضين ظاهرين وثبّت الهاتف أمام الشاشة."
            : "اقترب أكثر حتى يكاد الكود يملأ الإطار.",
        );
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    };
  }, [stopCamera]);

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

  return (
    <main className="scanner-page">
      <section className="scanner-intro">
        <p className="eyebrow">مستقبل RaptorQ للموبايل</p>
        <h1>{complete ? "تم استرداد الملف." : "وجّه. ثبّت. استقبل."}</h1>
        <p>
          {complete
            ? "اجتاز كائن RaptorQ والملف الأصلي فحصي المجموع الاختباري من الطرف إلى الطرف."
            : scanMode === "dual"
              ? "المسح المزدوج يقرأ قناتين متناوبتين بسرعة 30 fps؛ أي مسار ثابت يقدّم الملف."
              : "يقرأ الماسح QR ثنائياً خاماً واحداً لكل لقطة؛ الإطارات المفقودة لا تضر."}
        </p>
      </section>

      <section className="scanner-shell">
        <div className={`camera-view ${scanMode} ${active ? "active" : ""} ${complete ? "complete" : ""}`}>
          <video ref={videoRef} playsInline muted aria-label="معاينة الكاميرا الخلفية" />
          <canvas ref={canvasRef} hidden />
          <div className="scan-reticle" aria-hidden="true">
            <i /><i /><i /><i />
          </div>
          {!active && !complete && state !== "password" ? (
            <div className="camera-empty">
              <span className="camera-icon" aria-hidden="true">◎</span>
              <strong>الكاميرا متوقفة</strong>
              <span>
                {scanMode === "dual"
                  ? "مسار مزدوج محدد · أدر الهاتف أفقياً."
                  : "يبقى الفيديو على هذا الجهاز."}
              </span>
            </div>
          ) : null}
          {state === "starting" ? <div className="camera-loading">جارٍ تحميل مفكك الرموز…</div> : null}
          {complete ? <div className="complete-mark" aria-hidden="true">✓</div> : null}
          {torchAvailable && active ? (
            <button className="torch-button" type="button" onClick={toggleTorch}>
              {torchOn ? "إطفاء الضوء" : "تشغيل الضوء"}
            </button>
          ) : null}
        </div>

        <div className="receive-card">
          <div className="receive-status">
            <span className={`pulse-dot ${active ? "live" : ""}`} aria-hidden="true" />
            <strong>
              {state === "receiving"
                ? "جارٍ استقبال رموز RaptorQ"
                : state === "scanning"
                  ? "جارٍ البحث عن QRFerry"
                  : state === "password"
                    ? "يتطلب فك التشفير"
                    : complete
                      ? "تم التحقق من النقل"
                      : "جاهز للمسح"}
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

          {resumeNote ? <p className="resume-note" role="status">{resumeNote}</p> : null}

          {state === "password" && pendingDecryption ? (
            <div className="password-prompt">
              <strong>🔒 هذا الملف مشفَّر</strong>
              <p>
                يلزم إدخال كلمة المرور التي حدّدها المرسل لفك الملف. بدونها لا
                يمكن استرداد المحتوى حتى لو صُوّرت الشاشة.
              </p>
              <input
                className="password-input"
                type="password"
                dir="ltr"
                autoComplete="off"
                autoFocus
                value={promptPassword}
                placeholder="كلمة المرور"
                onChange={(event) => setPromptPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitPassword();
                }}
              />
              {promptError ? (
                <p className="prompt-error" role="alert">{promptError}</p>
              ) : null}
              <div className="prompt-actions">
                <button type="button" onClick={() => void submitPassword()}>
                  فكّ التشفير
                </button>
                <button type="button" onClick={cancelPassword}>
                  إلغاء
                </button>
              </div>
            </div>
          ) : null}

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
              QR مفرد
              <small>من Robust حتى Turbo 30</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={scanMode === "dual"}
              className={scanMode === "dual" ? "selected" : ""}
              disabled={active}
              onClick={() => chooseScanMode("dual")}
            >
              مسار مزدوج
              <small>Turbo 60 ووضع المختبر 1 Mbps</small>
            </button>
          </div>

          <div className="rate-panel" aria-live="polite">
            <div>
              <span>معدل الملف الفعلي</span>
              <strong>{effectiveRate > 0 ? formatRate(effectiveRate) : "—"}</strong>
              <small>
                {incoming?.compressed
                  ? `${formatRate(opticalRate)} بصرياً · مضغوط ${compressionPercent}%`
                  : `${formatRate(opticalRate)} بيانات بصرية مقبولة`}
              </small>
            </div>
            <div>
              <span>الوقت المتبقي</span>
              <strong>{complete ? "مكتمل" : formatEta(etaSeconds)}</strong>
              <small>
                {incoming
                  ? `${formatBytes(recoveredBytes)} من ${formatBytes(incoming.containerLength)} مشفَّر`
                  : "بانتظار أول رمز RaptorQ"}
              </small>
            </div>
          </div>

          {incoming ? (
            <div className="incoming-file">
              <span className="file-glyph" aria-hidden="true">↓</span>
              <div>
                <strong>{fileMeta?.filename || "الملف القادم"}</strong>
                <span>
                  {formatBytes(incoming.originalSize)}
                  {incoming.compressed ? ` · مضغوط ${compressionPercent}%` : ""}
                  {" · "}
                  {frames.toLocaleString()} / ~{incoming.sourcePacketCount.toLocaleString()} رموز
                </span>
              </div>
              <b>RQ</b>
            </div>
          ) : null}

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
              مُتفاوض عليه
            </span>
            <span>
              <b>
                {scanMetrics.deliveredFps
                  ? scanMetrics.deliveredFps.toFixed(1)
                  : "—"}{" "}
                fps
              </b>
              مستلَم
            </span>
            <span>
              <b>
                {scanMetrics.scannerFps
                  ? scanMetrics.scannerFps.toFixed(1)
                  : "—"}{" "}
                fps
              </b>
              ممسوح
            </span>
            <span>
              <b>
                {scanMetrics.decodeP50
                  ? `${scanMetrics.decodeP50.toFixed(0)} / ${scanMetrics.decodeP95.toFixed(0)} ملليثانية`
                  : "—"}
              </b>
              فك p50 / p95
            </span>
          </div>
          <div className="scan-diagnostics" aria-live="polite">
            <span><b>{qrReads}</b> قراءات QR</span>
            <span><b>{frames}</b> فريدة</span>
            <span><b>{missedExposures}</b> مفقودة</span>
            <span><b>{badFrames}</b> مرفوضة</span>
          </div>
          <p className="scan-hint">{guidance}</p>

          {error ? <p className="error-message" role="alert">{error}</p> : null}

          {complete && downloadUrl && fileMeta ? (
            <a className="primary-action" href={downloadUrl} download={fileMeta.filename}>
              <span aria-hidden="true">↓</span>
              حفظ {fileMeta.filename}
            </a>
          ) : (
            <button
              className="primary-action"
              type="button"
              disabled={state === "starting" || state === "password"}
              onClick={
                active
                  ? () => {
                      stopCamera();
                      setState("idle");
                      setGuidance("أوقفت الكاميرا. أعد تشغيلها عند الجاهزية.");
                    }
                  : startCamera
              }
            >
              <span aria-hidden="true">{active ? "■" : "◎"}</span>
              {state === "starting"
                ? "جارٍ التحميل…"
                : active
                  ? "إيقاف الكاميرا"
                  : "تشغيل الكاميرا"}
            </button>
          )}

          {complete ? (
            <button className="link-action" type="button" onClick={startCamera}>
              مسح نقل آخر
            </button>
          ) : null}
        </div>
      </section>

      <section className="scan-tips">
        <div><span>1</span><p>يتطلب Turbo 60 اختيار «مسار مزدوج» في القارئ ووضعاً أفقياً يُظهر الكودَين كاملين.</p></div>
        <div><span>2</span><p>يتغير مسار واحد فقط لكل تحديث، فيبقى الآخر نظيفاً أثناء انتقالات الستارة الدوّارة.</p></div>
        <div><span>3</span><p>إن لم يُقفل أي مسار، استخدم ملء الشاشة، واقترب أكثر، أو عد إلى Turbo 30 أحادي المسار.</p></div>
      </section>
    </main>
  );
}
