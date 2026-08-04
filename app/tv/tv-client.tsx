"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Monitor,
  Play,
  Pause,
  RotateCcw,
  Smartphone,
  Volume2,
  VolumeX,
} from "lucide-react";
import { FastReceiver, getPeerServerConfig, setPeerServerConfig, type IncomingTransferFile } from "@/lib/fast-transfer";
import { renderRawQr } from "@/lib/qr-renderer";
import { useI18n } from "../lang-provider";
import { parsePeerServerUrl } from "@/lib/tv-compat";

type TvState = "starting" | "ready" | "receiving" | "complete" | "error" | "phone-blocked";

type ReceivedFile = {
  name: string;
  mime: string;
  size: number;
  url: string;
};

declare global {
  interface Window {
    __qrferryTvInfo?: { peerId: string; passcode: string; payload: string };
    __qrferryTvReceived?: { name: string; mime: string; size: number; bytes: number[] };
    __qrferryTvModules?: { n: number; data: number[] };
  }
}

/**
 * وضع الشاشة الكبيرة (تلفاز/تابلت/لابتوب): يعرض رمز اقتران QR على يمين
 * الشاشة (في RTL) وتعليمات أفقية على اليسار، ويستقبل الملف عبر الشبكة
 * المحلية (P2P مشفر) ثم يحفظه أو يشغّله. ملاحة كاملة بالريموت.
 *
 * ملاحظات معمارية:
 * - البايتات تُحفظ في ref (لا في React state) حتى لا تُحمَّل 61MB مع كل
 *   إعادة رسم — يُعرض الملف عبر Blob URL فقط.
 * - زر الحفظ يستخدم File System Access API عند توفره (حفظ حقيقي)، مع
 *   سقوط آمن إلى تنزيل `<a download>`.
 * - الصفحة مخصصة للأجهزة الكبيرة؛ تُحجب على الهواتف برسالة واضحة.
 */
export function TvClient() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<TvState>("starting");
  const [passcode, setPasscode] = useState("");
  const [qrCanvas, setQrCanvas] = useState<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const [status, setStatus] = useState("");
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null);
  const [error, setError] = useState("");
  const receiverRef = useRef<FastReceiver | null>(null);
  const qrHostRef = useRef<HTMLDivElement>(null);
  const [signalingHost, setSignalingHost] = useState("");
  const [signalHostInput, setSignalHostInput] = useState("");
  const [signalApplied, setSignalApplied] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const receivedBytesRef = useRef<Uint8Array | null>(null);

  // كشف الهاتف: شاشة صغيرة + مؤشر لمس خشن (coarse) = هاتف
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      const small = window.innerWidth < 720;
      setIsPhone(coarse && small);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleFile = useCallback((file: IncomingTransferFile) => {
    const url = URL.createObjectURL(
      new Blob([file.bytes.buffer as BlobPart], { type: file.mime }),
    );
    // البايتات في ref فقط (لا تُحمل مع إعادة رسم React)
    receivedBytesRef.current = file.bytes;
    setReceivedFile({ name: file.name, mime: file.mime, size: file.size, url });
    setState("complete");
    setIsPlaying(false);
    setIsMuted(false);
    navigator.vibrate?.([80, 40, 120]);
    // هوك اختبار (يقرأ من ref — لا نسخ ضخم في الـ UI)
    window.__qrferryTvReceived = {
      name: file.name,
      mime: file.mime,
      size: file.size,
      bytes: Array.from(file.bytes),
    };
  }, []);

  const initReceiver = useCallback(async () => {
    setState("starting");
    setError("");
    setReceivedFile(null);
    receivedBytesRef.current = null;
    setProgress({ received: 0, total: 0 });
    receiverRef.current?.destroy();
    try {
      const receiver = await FastReceiver.create(
        handleFile,
        (received, total) => setProgress({ received, total }),
        (message) => setStatus(message),
      );
      receiverRef.current = receiver;
      setPasscode(receiver.passcode);
      window.__qrferryTvInfo = {
        peerId: receiver.peerId,
        passcode: receiver.passcode,
        payload: receiver.payload,
      };
      const image = await renderRawQr(
        new TextEncoder().encode(receiver.payload),
        7,
        "M",
        8,
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d");
      context.putImageData(image, 0, 0);
      setQrCanvas(canvas);

      // هوك اختبار: مصفوفة وحدات QR لاختبارات E2E (كاميرا محاكاة)
      try {
        const scale = 8;
        const n = Math.round(image.width / scale);
        const modules = new Uint8Array(n * n);
        for (let y = 0; y < n; y += 1) {
          for (let x = 0; x < n; x += 1) {
            const pixel = (y * scale) * image.width + x * scale;
            modules[y * n + x] = image.data[pixel * 4] < 128 ? 1 : 0;
          }
        }
        window.__qrferryTvModules = { n, data: Array.from(modules) };
      } catch {
        // الهوك اختياري
      }

      setState("ready");
    } catch (cause) {
      setState("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذّر تشغيل وضع الاستقبال. تأكد من اتصال الجهاز بالشبكة.",
      );
    }
  }, [handleFile]);

  useEffect(() => {
    const timer = window.setTimeout(() => void initReceiver(), 0);
    const configTimer = window.setTimeout(() => {
      const config = getPeerServerConfig();
      setSignalingHost(
        config.secure ? `wss://${config.host}:${config.port}${config.path}` : `ws://${config.host}:${config.port}${config.path}`,
      );
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(configTimer);
      receiverRef.current?.destroy();
    };
  }, [initReceiver]);

  // ملاحة الريموت: الأسهم تتنقل بين العناصر القابلة للتركيز، و OK تُفعّل
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>(".tv-btn, .tv-signal-apply, input.tv-signal-input"),
      );
      if (focusables.length === 0) return;
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        focusables[(index + 1) % focusables.length]?.focus();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        focusables[(index - 1 + focusables.length) % focusables.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  const applySignalHost = useCallback(() => {
    const parsed = parsePeerServerUrl(signalHostInput.trim());
    if (!parsed) {
      setSignalApplied(false);
      return;
    }
    setPeerServerConfig(parsed);
    setSignalApplied(true);
    window.setTimeout(() => void initReceiver(), 300);
  }, [initReceiver, signalHostInput]);

  useEffect(() => {
    if (qrCanvas && qrHostRef.current) {
      qrHostRef.current.replaceChildren(qrCanvas);
    }
  }, [qrCanvas]);

  const percent =
    progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const formatBytes = (value: number) => {
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB"];
    let v = value;
    let unit = units[0];
    for (let index = 1; index < units.length && v >= 1024; index += 1) {
      v /= 1024;
      unit = units[index];
    }
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${unit}`;
  };

  const isMedia = (mime: string) => mime.startsWith("video/") || mime.startsWith("audio/") || mime.startsWith("image/");

  /**
   * حفظ حقيقي للملف:
   * 1) File System Access API (حفظ في نظام ملفات الجهاز) عند توفره.
   * 2) سقوط آمن: تنزيل `<a download>` مع إضافة العنصر للـ DOM (أكثر موثوقية).
   */
  const saveFile = useCallback(async () => {
    const file = receivedFile;
    const bytes = receivedBytesRef.current;
    if (!file || !bytes) return;
    try {
      const picker = (
        window as unknown as {
          showSaveFilePicker?: (options: {
            suggestedName: string;
            types?: Array<{ description: string; accept: Record<string, string[]> }>;
          }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
        }
      ).showSaveFilePicker;
      if (picker) {
        const handle = await picker({
          suggestedName: file.name,
          types: file.mime ? [{ description: file.name, accept: { [file.mime]: [".bin"] } }] : undefined,
        });
        const writable = await handle.createWritable();
        await writable.write(new Blob([bytes.buffer as BlobPart], { type: file.mime }));
        await writable.close();
        return;
      }
    } catch {
      // المستخدم ألغى أو API غير متاح → ننتقل للسقوط الآمن
    }
    // سقوط آمن: `<a download>` مدمج في DOM
    const anchor = document.createElement("a");
    anchor.href = file.url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [receivedFile]);

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      void media.play().then(() => setIsPlaying(true)).catch(() => undefined);
    } else {
      media.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !media.muted;
    setIsMuted(media.muted);
  }, []);

  // شاشة الهاتف: رسالة واضحة بدل التشغيل
  if (isPhone) {
    return (
      <main className="tv-page tv-phone-blocked">
        <div className="tv-center tv-phone-msg">
          <Smartphone size={72} strokeWidth={1.5} aria-hidden="true" />
          <h1>{lang === "ar" ? "هذه الصفحة مخصصة للشاشات الكبيرة" : "This page is for large screens"}</h1>
          <p className="tv-hint">
            {lang === "ar"
              ? "افتحها على التلفاز أو التابلت أو اللابتوب لاستقبال الملفات. على هاتفك استخدم صفحة «إرسال» لبدء النقل."
              : "Open it on a TV, tablet, or laptop to receive files. On your phone use the “Send” page to start a transfer."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={`tv-page tv-${state}`}>
      <header className="tv-header">
        <span className="tv-logo">QRFerry</span>
        <span className="tv-tag">{t("tv.tag")}</span>
        <span className="tv-signaling" title="خادم التسيير">{signalingHost || "…"}</span>
      </header>

      <div className="tv-signal-host">
        <label htmlFor="tv-signal-input">{t("tv.signalHost")}</label>
        <input
          id="tv-signal-input"
          className="tv-signal-input"
          dir="ltr"
          placeholder="ws://192.168.1.5:9000/peerjs"
          value={signalHostInput}
          onChange={(event) => setSignalHostInput(event.target.value)}
        />
        <button type="button" className="tv-btn tv-btn-ghost tv-signal-apply" onClick={() => applySignalHost()}>
          {t("tv.signalApply")}
        </button>
        {signalApplied ? <span className="tv-signal-applied">{t("tv.signalApplied")}</span> : null}
        <p className="tv-hint">{t("tv.signalHint")}</p>
      </div>

      {state === "starting" ? (
        <div className="tv-center">
          <h1>{t("tv.starting")}</h1>
        </div>
      ) : state === "error" ? (
        <div className="tv-center">
          <h1>{error}</h1>
          <button type="button" className="tv-btn" onClick={() => void initReceiver()}>
            <RotateCcw size={20} aria-hidden="true" />
            {t("tv.retry")}
          </button>
          <p className="tv-hint">{t("tv.networkHint")}</p>
        </div>
      ) : state === "ready" ? (
        <div className="tv-ready">
          {/* RTL: QR أولاً = يمين؛ LTR: QR أولاً = يسار (يُعكس تلقائياً) */}
          <div className="tv-qr-box">
            <div ref={qrHostRef}>{!qrCanvas ? <p>…</p> : null}</div>
            <h2>{t("tv.scanTitle")}</h2>
            <p className="tv-code">
              {t("tv.sessionCode")}: <b>{passcode}</b>
            </p>
          </div>
          <div className="tv-instructions">
            <h3>
              <Monitor size={26} aria-hidden="true" />
              {t("tv.howTitle")}
            </h3>
            <ol className="tv-steps">
              <li data-n="1">{t("tv.how1")}</li>
              <li data-n="2">{t("tv.how2")}</li>
              <li data-n="3">{t("tv.how3")}</li>
            </ol>
            <p className="tv-hint">{t("tv.sameNetwork")}</p>
          </div>
        </div>
      ) : state === "receiving" ? (
        <div className="tv-center">
          <h1>{status || t("tv.receiving")}</h1>
          <div className="tv-progress-track">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="tv-progress-text">
            {formatBytes(progress.received)} / {formatBytes(progress.total)} · {percent}%
          </p>
        </div>
      ) : state === "complete" && receivedFile ? (
        <div className="tv-center tv-complete">
          <h1>{t("tv.complete")}</h1>
          <p className="tv-file-name">{receivedFile.name}</p>
          <p className="tv-file-size">{formatBytes(receivedFile.size)}</p>

          {isMedia(receivedFile.mime) ? (
            <div className="tv-media">
              {receivedFile.mime.startsWith("video/") ? (
                <video
                  ref={(node) => {
                    mediaRef.current = node;
                  }}
                  src={receivedFile.url}
                  controls={false}
                  autoPlay={false}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              ) : receivedFile.mime.startsWith("audio/") ? (
                <audio
                  ref={(node) => {
                    mediaRef.current = node;
                  }}
                  src={receivedFile.url}
                  controls={false}
                  autoPlay={false}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={receivedFile.url} alt={receivedFile.name} />
              )}
            </div>
          ) : null}

          <div className="tv-actions">
            <button type="button" className="tv-btn" onClick={() => void saveFile()}>
              <Download size={20} aria-hidden="true" />
              {t("tv.saveFile")}
            </button>
            {isMedia(receivedFile.mime) && !receivedFile.mime.startsWith("image/") ? (
              <button type="button" className="tv-btn tv-btn-ghost" onClick={togglePlay}>
                {isPlaying ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
                {isPlaying
                  ? lang === "ar" ? "إيقاف مؤقت" : "Pause"
                  : lang === "ar" ? "تشغيل" : "Play"}
              </button>
            ) : null}
            {receivedFile.mime.startsWith("audio/") || receivedFile.mime.startsWith("video/") ? (
              <button type="button" className="tv-btn tv-btn-ghost" onClick={toggleMute}>
                {isMuted ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
                {isMuted
                  ? lang === "ar" ? "إلغاء الكتم" : "Unmute"
                  : lang === "ar" ? "كتم" : "Mute"}
              </button>
            ) : null}
            <button type="button" className="tv-btn tv-btn-ghost" onClick={() => void initReceiver()}>
              <RotateCcw size={20} aria-hidden="true" />
              {t("tv.receiveAnother")}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
