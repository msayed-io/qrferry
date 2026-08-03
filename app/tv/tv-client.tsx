"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FastReceiver, getPeerServerConfig, type IncomingTransferFile } from "@/lib/fast-transfer";
import { renderRawQr } from "@/lib/qr-renderer";

type TvState = "starting" | "ready" | "receiving" | "complete" | "error";

type ReceivedFile = {
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
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
 * وضع التلفزيون: يعرض رمز اقتران QR على الشاشة الكبيرة، ويستقبل الملف
 * عبر الشبكة المحلية (P2P مشفر) ثم يحفظه/يشغّله. ملاحة كاملة بالريموت.
 */
export function TvClient() {
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
  const [showMedia, setShowMedia] = useState(true);

  const handleFile = useCallback((file: IncomingTransferFile) => {
    const url = URL.createObjectURL(new Blob([file.bytes.buffer as BlobPart], { type: file.mime }));
    setReceivedFile({ name: file.name, mime: file.mime, size: file.size, bytes: file.bytes, url });
    setState("complete");
    navigator.vibrate?.([80, 40, 120]);
    // هوك اختبار
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
          : "تعذّر تشغيل وضع الاستقبال. تأكد من اتصال التلفزيون بالشبكة.",
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

  return (
    <main className={`tv-page tv-${state}`}>
      <header className="tv-header">
        <span className="tv-logo">QRFerry</span>
        <span className="tv-tag">استقبال على الشاشة الكبيرة</span>
        <span className="tv-signaling" title="خادم التسيير">{signalingHost || "…"}</span>
      </header>

      {state === "starting" ? (
        <div className="tv-center">
          <h1>جارٍ تجهيز الاستقبال…</h1>
        </div>
      ) : state === "error" ? (
        <div className="tv-center">
          <h1>⚠️ {error}</h1>
          <button type="button" className="tv-btn" onClick={() => void initReceiver()}>
            إعادة المحاولة
          </button>
          <p className="tv-hint">
            تأكد أن التلفزيون متصل بالشبكة، وأن صفحة الاستقبال تُفتح على نفس شبكة الهاتف.
          </p>
        </div>
      ) : state === "ready" ? (
        <div className="tv-ready">
          <div className="tv-qr-box">
            <div ref={qrHostRef}>{!qrCanvas ? <p>…</p> : null}</div>
            <h2>امسح هذا الرمز من هاتفك</h2>
            <p className="tv-code">
              رمز الجلسة: <b>{passcode}</b>
            </p>
          </div>
          <div className="tv-instructions">
            <h3>للاستقبال من هاتفك</h3>
            <ol>
              <li>افتح <b>qrferry</b> على هاتفك</li>
              <li>اختر الملف (أو أكثر) واضغط «نقل سريع»</li>
              <li>صوّر هذا الرمز بالكاميرا</li>
              <li>سيظهر التقدم هنا — والملف يُحفظ ويُشغّل على الشاشة</li>
            </ol>
            <p className="tv-hint">يجب أن يكون الهاتف والتلفزيون على نفس الشبكة المحلية.</p>
          </div>
        </div>
      ) : state === "receiving" ? (
        <div className="tv-center">
          <h1>{status || "جارٍ الاستقبال…"}</h1>
          <div className="tv-progress-track">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="tv-progress-text">
            {formatBytes(progress.received)} / {formatBytes(progress.total)} · {percent}%
          </p>
        </div>
      ) : state === "complete" && receivedFile ? (
        <div className="tv-center tv-complete">
          <h1>✓ تم الاستقبال</h1>
          <p className="tv-file-name">{receivedFile.name}</p>
          <p className="tv-file-size">{formatBytes(receivedFile.size)}</p>

          {showMedia && isMedia(receivedFile.mime) ? (
            <div className="tv-media">
              {receivedFile.mime.startsWith("video/") ? (
                <video src={receivedFile.url} controls autoPlay />
              ) : receivedFile.mime.startsWith("audio/") ? (
                <audio src={receivedFile.url} controls autoPlay />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={receivedFile.url} alt={receivedFile.name} />
              )}
            </div>
          ) : null}

          <div className="tv-actions">
            <a className="tv-btn" href={receivedFile.url} download={receivedFile.name}>
              💾 حفظ الملف
            </a>
            {isMedia(receivedFile.mime) ? (
              <button
                type="button"
                className="tv-btn tv-btn-ghost"
                onClick={() => setShowMedia((current) => !current)}
              >
                {showMedia ? "إخفاء المشغّل" : "إظهار المشغّل"}
              </button>
            ) : null}
            <button type="button" className="tv-btn tv-btn-ghost" onClick={() => void initReceiver()}>
              استقبال ملف آخر
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
