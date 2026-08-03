"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FastReceiver, getPeerServerConfig, setPeerServerConfig, type IncomingTransferFile } from "@/lib/fast-transfer";
import { renderRawQr } from "@/lib/qr-renderer";
import { useI18n } from "../lang-provider";
import {
  checkTvCompatibility,
  parsePeerServerUrl,
  tvCompatibilitySummary,
  type TvCompatibility,
} from "@/lib/tv-compat";

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
  const { t } = useI18n();
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
  const [compat, setCompat] = useState<TvCompatibility | null>(null);
  const [signalHostInput, setSignalHostInput] = useState("");
  const [signalApplied, setSignalApplied] = useState(false);
  const [showCompat, setShowCompat] = useState(false);

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
    const compatTimer = window.setTimeout(() => {
      setCompat(checkTvCompatibility());
    }, 0);
    const timer = window.setTimeout(() => void initReceiver(), 0);
    const configTimer = window.setTimeout(() => {
      const config = getPeerServerConfig();
      setSignalingHost(
        config.secure ? `wss://${config.host}:${config.port}${config.path}` : `ws://${config.host}:${config.port}${config.path}`,
      );
    }, 0);
    return () => {
      window.clearTimeout(compatTimer);
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

  const compatSummary = compat ? tvCompatibilitySummary(compat) : null;

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
        <span className="tv-tag">{t("tv.tag")}</span>
        <span className="tv-signaling" title="خادم التسيير">{signalingHost || "…"}</span>
      </header>

      <div className="tv-settings">
        <details className="tv-compat" open={showCompat} onToggle={(event) => setShowCompat(event.currentTarget.open)}>
          <summary>{t("tv.compatTitle")}</summary>
          {compat && compatSummary ? (
            <>
              {compatSummary.canReceive ? (
                <p className="tv-compat-ok">{t("tv.compatOk")}</p>
              ) : (
                <p className="tv-compat-bad">{t("tv.compatBad")}</p>
              )}
              <p className="tv-compat-detail">{t("tv.compatDetail")}</p>
              <ul className="tv-compat-list">
                <li>{t("tv.compatWebRtc")}: {compat.webRtc ? `✓ ${t("tv.compatYes")}` : `✗ ${t("tv.compatNo")}`}</li>
                <li>{t("tv.compatWebSocket")}: {compat.webSocket ? `✓ ${t("tv.compatYes")}` : `✗ ${t("tv.compatNo")}`}</li>
                <li>{t("tv.compatDownload")}: {compat.download ? `✓ ${t("tv.compatYes")}` : `✗ ${t("tv.compatNo")}`}</li>
                <li>{t("tv.compatMedia")}: {compat.mediaPlayback ? `✓ ${t("tv.compatYes")}` : `✗ ${t("tv.compatNo")}`}</li>
              </ul>
            </>
          ) : (
            <p className="tv-compat-detail">…</p>
          )}
        </details>

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

        <p className="tv-nav-hint">🎮 {t("tv.navHint")}</p>
      </div>

      {state === "starting" ? (
        <div className="tv-center">
          <h1>{t("tv.starting")}</h1>
        </div>
      ) : state === "error" ? (
        <div className="tv-center">
          <h1>⚠️ {error}</h1>
          <button type="button" className="tv-btn" onClick={() => void initReceiver()}>
            {t("tv.retry")}
          </button>
          <p className="tv-hint">
            {t("tv.networkHint")}
          </p>
        </div>
      ) : state === "ready" ? (
        <div className="tv-ready">
          <div className="tv-qr-box">
            <div ref={qrHostRef}>{!qrCanvas ? <p>…</p> : null}</div>
            <h2>{t("tv.scanTitle")}</h2>
            <p className="tv-code">
              {t("tv.sessionCode")}: <b>{passcode}</b>
            </p>
          </div>
          <div className="tv-instructions">
            <h3>{t("tv.howTitle")}</h3>
            <ol>
              <li>{t("tv.how1")}</li>
              <li>{t("tv.how2")}</li>
              <li>{t("tv.how3")}</li>
              <li>{t("tv.how4")}</li>
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
          <h1>✓ {t("tv.complete")}</h1>
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
              💾 {t("tv.saveFile")}
            </a>
            {isMedia(receivedFile.mime) ? (
              <button
                type="button"
                className="tv-btn tv-btn-ghost"
                onClick={() => setShowMedia((current) => !current)}
              >
                {showMedia ? t("tv.hidePlayer") : t("tv.showPlayer")}
              </button>
            ) : null}
            <button type="button" className="tv-btn tv-btn-ghost" onClick={() => void initReceiver()}>
              {t("tv.receiveAnother")}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
