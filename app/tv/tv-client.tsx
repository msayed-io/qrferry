"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Monitor,
  RotateCcw,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  FastReceiver,
  DEFAULT_PEER_SERVER,
  getPeerServerConfig,
  setPeerServerConfig,
  type IncomingTransferFile,
} from "@/lib/fast-transfer";
import { renderRawQr } from "@/lib/qr-renderer";
import { useI18n } from "../lang-provider";
import {
  checkTvCompatibility,
  parsePeerServerUrl,
  type TvCompatibility,
} from "@/lib/tv-compat";
import {
  storeReceivedFile,
  listReceivedFiles,
  loadReceivedFileBytes,
  deleteReceivedFile,
  type ReceivedFileMetadata,
} from "@/lib/received-files-store";
import {
  unpackReceivedDelivery,
  receivedBlob,
  type ReceivedMediaFile,
  type ReceivedDelivery,
} from "@/lib/received-media";
import { getTrustedKeys } from "@/lib/identity-store";
import { saveReceivedFile } from "@/lib/save-received-file";
import { ReceivedPlayer, type DisplayFile } from "./received-player";

declare global {
  interface Window {
    __qrferryTestMode?: boolean;
    __qrferryTvInfo?: { peerId: string; passcode: string; payload: string };
    __qrferryTvReceived?: {
      name: string;
      mime: string;
      size: number;
      bytes: number[];
    };
    __qrferryTvModules?: { n: number; data: number[] };
  }
}
type TvState =
  | "starting"
  | "ready"
  | "receiving"
  | "verifying"
  | "complete"
  | "error";
type LibraryState = "idle" | "saving" | "saved" | "failed" | "loaded";
const VERSION = "TV-RECEIVE-2";

export function TvClient() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [state, setState] = useState<TvState>("starting");
  const [isPhone, setIsPhone] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [qrCanvas, setQrCanvas] = useState<HTMLCanvasElement | null>(null);
  const qrHost = useRef<HTMLDivElement>(null);
  const receiver = useRef<FastReceiver | null>(null);
  const generation = useRef(0);
  const deliveryJob = useRef(0);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [libraryState, setLibraryState] = useState<LibraryState>("idle");
  const [library, setLibrary] = useState<ReceivedFileMetadata[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [files, setFiles] = useState<
    Array<{ name: string; mime: string; size: number }>
  >([]);
  const bytes = useRef<ReceivedMediaFile[]>([]);
  const activeIndex = useRef(0);
  const activeUrl = useRef<string | null>(null);
  const [file, setFile] = useState<DisplayFile | null>(null);
  const [signature, setSignature] =
    useState<ReceivedDelivery["signature"]>("unsigned");
  const [checksum, setChecksum] = useState<number | null>(null);
  const [signalingHost, setSignalingHost] = useState("");
  const [signalHostInput, setSignalHostInput] = useState("");
  const [signalApplied, setSignalApplied] = useState(false);
  const [compat, setCompat] = useState<TvCompatibility | null>(null);
  const [userAgent, setUserAgent] = useState("");
  const [secure, setSecure] = useState(false);

  const invalidatePendingWork = useCallback(() => {
    generation.current++;
    deliveryJob.current++;
  }, []);

  const releaseUrl = useCallback(() => {
    if (activeUrl.current) {
      URL.revokeObjectURL(activeUrl.current);
      activeUrl.current = null;
    }
  }, []);
  const selectFile = useCallback(
    (index: number) => {
      const f = bytes.current[index];
      if (!f) return;
      const url = URL.createObjectURL(receivedBlob(f.bytes, f.mime));
      releaseUrl();
      activeUrl.current = url;
      activeIndex.current = index;
      setFile({ name: f.name, mime: f.mime, size: f.bytes.byteLength, url });
    },
    [releaseUrl],
  );
  const displayDelivery = useCallback(
    (delivery: ReceivedDelivery) => {
      bytes.current = delivery.files;
      setFiles(
        delivery.files.map((f) => ({
          name: f.name,
          mime: f.mime,
          size: f.bytes.byteLength,
        })),
      );
      setSignature(delivery.signature);
      selectFile(0);
      setState("complete");
    },
    [selectFile],
  );

  const handleFile = useCallback(
    async (incoming: IncomingTransferFile) => {
      const gen = generation.current,
        job = ++deliveryJob.current;
      const current = () =>
        gen === generation.current && job === deliveryJob.current;
      setState("verifying");
      setError("");
      setLibraryError("");
      setLibraryState("idle");
      try {
        const delivery = await unpackReceivedDelivery(
          incoming,
          await getTrustedKeys(),
        );
        if (!current()) return;
        setChecksum(incoming.checksum ?? null);
        displayDelivery(delivery);
        // Only explicit, injected test contexts get byte-array hooks; never expand large files in production.
        if (window.__qrferryTestMode)
          window.__qrferryTvReceived = {
            name: incoming.name,
            mime: incoming.mime,
            size: incoming.size,
            bytes: Array.from(incoming.bytes),
          };
        setLibraryState("saving");
        try {
          // Save actual extracted files, not an opaque QFPA container. Playback is independent of IndexedDB.
          for (const f of delivery.files) {
            if (!current()) return;
            await storeReceivedFile(f);
          }
          if (!current()) return;
          setLibraryState("saved");
          setLibrary(await listReceivedFiles(50));
        } catch (cause) {
          if (!current()) return;
          setLibraryState("failed");
          setLibraryError(
            (ar
              ? "وصلت البيانات، لكن الحفظ داخل مكتبة المتصفح فشل. الملف متاح الآن ما دامت الصفحة مفتوحة. السبب: "
              : "Received, but saving in the browser library failed. The file is still available while this page remains open. Reason: ") +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      } catch (cause) {
        if (current()) {
          setState("error");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    },
    [ar, displayDelivery],
  );

  const initReceiver = useCallback(async () => {
    const gen = ++generation.current;
    deliveryJob.current++;
    receiver.current?.destroy();
    receiver.current = null;
    releaseUrl();
    bytes.current = [];
    setFile(null);
    setFiles([]);
    setQrCanvas(null);
    if (window.__qrferryTestMode) {
      delete window.__qrferryTvInfo;
      delete window.__qrferryTvModules;
      delete window.__qrferryTvReceived;
    }
    setState("starting");
    setError("");
    setStatus("");
    setProgress({ received: 0, total: 0 });
    setChecksum(null);
    setLibraryState("idle");
    const phone =
      (window.matchMedia?.("(pointer: coarse)").matches ?? false) &&
      window.innerWidth < 720;
    setIsPhone(phone);
    if (phone) return;
    const capabilities = checkTvCompatibility();
    setCompat(capabilities);
    setUserAgent(navigator.userAgent);
    setSecure(window.isSecureContext);
    const config = getPeerServerConfig();
    setSignalingHost(
      `${config.secure ? "wss" : "ws"}://${config.host}:${config.port}${config.path}`,
    );
    if (!capabilities.webRtc || !capabilities.webSocket) {
      setState("error");
      setError(
        ar
          ? "هذا المتصفح لا يدعم WebRTC/WebSocket اللازمة للاستقبال. استخدم متصفحًا/جهازًا متوافقًا."
          : "This browser lacks WebRTC/WebSocket support.",
      );
      return;
    }
    try {
      const next = await FastReceiver.create(
        (incoming) => {
          if (generation.current === gen) void handleFile(incoming);
        },
        (received, total) => {
          if (generation.current !== gen) return;
          setProgress({ received, total });
          setState("receiving");
        },
        (message) => {
          if (generation.current === gen) setStatus(message);
        },
        (message) => {
          if (generation.current === gen) {
            setError(message);
            setState("error");
          }
        },
      );
      if (gen !== generation.current) {
        next.destroy();
        return;
      }
      receiver.current = next;
      setPasscode(next.passcode);
      if (window.__qrferryTestMode)
        window.__qrferryTvInfo = {
          peerId: next.peerId,
          passcode: next.passcode,
          payload: next.payload,
        };
      const image = await renderRawQr(
        new TextEncoder().encode(next.payload),
        7,
        "M",
        8,
      );
      if (gen !== generation.current) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("QR canvas unavailable");
      ctx.putImageData(image, 0, 0);
      setQrCanvas(canvas);
      if (window.__qrferryTestMode) {
        const scale = 8,
          n = Math.round(image.width / scale),
          data = [];
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++)
            data.push(
              image.data[(y * scale * image.width + x * scale) * 4] < 128
                ? 1
                : 0,
            );
        window.__qrferryTvModules = { n, data };
      }
      setState("ready");
    } catch (cause) {
      if (gen !== generation.current) return;
      receiver.current?.destroy();
      receiver.current = null;
      setState("error");
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : ar
            ? "تعذّر إنشاء جلسة الاستقبال. افحص الشبكة وخادم الاقتران."
            : "Could not create the receiver. Check signaling and connectivity.",
      );
    }
  }, [ar, handleFile, releaseUrl]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void initReceiver();
      void listReceivedFiles(50)
        .then((rows) => {
          if (!cancelled) setLibrary(rows);
        })
        .catch((cause) => {
          if (!cancelled)
            setLibraryError(
              (ar ? "المكتبة غير متاحة: " : "Library unavailable: ") +
                (cause instanceof Error ? cause.message : String(cause)),
            );
        });
    }, 0);
    // These are generation counters, not DOM refs: invalidate pending async work on unmount.
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      invalidatePendingWork();
      receiver.current?.destroy();
      releaseUrl();
      bytes.current = [];
    };
  }, [ar, initReceiver, releaseUrl, invalidatePendingWork]);
  useEffect(() => {
    if (qrCanvas && qrHost.current) qrHost.current.replaceChildren(qrCanvas);
  }, [qrCanvas]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Leave cursor movement in inputs/native controls to the browser.
      if ((document.activeElement as HTMLElement)?.matches("input,audio,video"))
        return;
      if (
        !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)
      )
        return;
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".tv-btn:not(:disabled), .tv-library-item, .tv-file-select, input.tv-signal-input, .tv-diagnostics summary",
        ),
      ).filter((el) => el.getClientRects().length > 0);
      if (!elements.length) return;
      event.preventDefault();
      const i = elements.indexOf(document.activeElement as HTMLElement),
        step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      elements[(i + step + elements.length) % elements.length]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const applySignal = () => {
    const value = signalHostInput.trim(),
      parsed = value ? parsePeerServerUrl(value) : DEFAULT_PEER_SERVER;
    if (!parsed) {
      setError(ar ? "عنوان خادم غير صالح." : "Invalid signaling URL.");
      return;
    }
    if (
      window.location.protocol === "https:" &&
      !parsed.secure &&
      !["localhost", "127.0.0.1"].includes(parsed.host)
    ) {
      setError(
        ar
          ? "استخدم wss:// مع صفحة HTTPS لتجنب حظر الاتصال غير الآمن."
          : "Use wss:// with an HTTPS page to avoid mixed-content blocking.",
      );
      return;
    }
    setPeerServerConfig(parsed);
    setSignalApplied(true);
    void initReceiver();
  };
  const openFromLibrary = async (entry: ReceivedFileMetadata) => {
    const gen = generation.current,
      job = ++deliveryJob.current;
    try {
      const data = await loadReceivedFileBytes(entry.id);
      if (!data)
        throw new Error(
          ar ? "الملف لم يعد موجودًا." : "File no longer available.",
        );
      const delivery = await unpackReceivedDelivery(
        { ...entry, bytes: new Uint8Array(data) },
        await getTrustedKeys(),
      );
      if (gen !== generation.current || job !== deliveryJob.current) return;
      displayDelivery(delivery);
      setChecksum(null);
      setLibraryState("loaded");
      setError("");
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const removeFromLibrary = async (id: string) => {
    try {
      await deleteReceivedFile(id);
      setLibrary(await listReceivedFiles(50));
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const percent = progress.total
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : 0;
  const libraryLabels = {
    idle: ar ? "لم يبدأ" : "Not started",
    saving: ar ? "جارٍ الحفظ داخل المتصفح…" : "Saving in browser…",
    saved: ar
      ? "حُفظ داخل مكتبة المتصفح، وليس في مجلد تنزيلات الجهاز."
      : "Saved in browser library, not the device Downloads folder.",
    failed: ar
      ? "فشل الحفظ المحلي؛ لا تغلق الصفحة."
      : "Local save failed; keep this page open.",
    loaded: ar ? "فُتح من مكتبة المتصفح." : "Opened from browser library.",
  };
  if (isPhone)
    return (
      <main className="tv-page tv-phone-blocked">
        <div className="tv-center tv-phone-msg">
          <Smartphone size={72} />
          <h1>
            {ar
              ? "هذه الصفحة مخصصة للشاشات الكبيرة"
              : "This page is for large screens"}
          </h1>
          <p>
            {ar
              ? "افتحها على التلفاز أو التابلت أو اللابتوب."
              : "Open it on a TV, tablet or laptop."}
          </p>
        </div>
      </main>
    );
  return (
    <main className={`tv-page tv-${state}`}>
      <header className="tv-header">
        <span className="tv-logo">QRFerry</span>
        <span className="tv-tag">{t("tv.tag")}</span>
        <span className="tv-signaling">{signalingHost || "…"}</span>
      </header>
      <div className="tv-signal-host">
        <label htmlFor="tv-signal-input">{t("tv.signalHost")}</label>
        <input
          id="tv-signal-input"
          className="tv-signal-input"
          dir="ltr"
          placeholder="wss://your-server/peerjs"
          value={signalHostInput}
          onChange={(e) => setSignalHostInput(e.target.value)}
        />
        <button
          type="button"
          className="tv-btn tv-btn-ghost tv-signal-apply"
          onClick={applySignal}
        >
          {t("tv.signalApply")}
        </button>
        {signalApplied ? (
          <span className="tv-signal-applied">{t("tv.signalApplied")}</span>
        ) : null}
        <p className="tv-hint">{t("tv.signalHint")}</p>
        <button
          type="button"
          className="tv-btn tv-btn-ghost tv-library-btn"
          onClick={() => {
            setShowLibrary((v) => !v);
            void listReceivedFiles(50)
              .then(setLibrary)
              .catch((cause) =>
                setLibraryError(
                  cause instanceof Error ? cause.message : String(cause),
                ),
              );
          }}
        >
          <FolderOpen size={20} />
          {ar ? "الملفات المستلمة" : "Received files"}
          {library.length ? ` (${library.length})` : ""}
        </button>
      </div>
      {libraryError ? (
        <p className="tv-storage-error" role="alert">
          {libraryError}
        </p>
      ) : null}
      {showLibrary ? (
        <div className="tv-library">
          {!library.length ? (
            <p>
              {ar
                ? "لا توجد ملفات محفوظة في مكتبة المتصفح بعد."
                : "No files saved in browser library yet."}
            </p>
          ) : (
            <ul className="tv-library-list">
              {library.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="tv-library-item"
                    onClick={() => void openFromLibrary(f)}
                  >
                    <span className="tv-library-name">{f.name}</span>
                    <span className="tv-library-meta">
                      {f.size.toLocaleString()} B
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tv-btn tv-btn-ghost tv-library-delete"
                    aria-label={ar ? "حذف" : "Delete"}
                    onClick={() => void removeFromLibrary(f.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {state === "starting" ? (
        <div className="tv-center">
          <h1>{t("tv.starting")}</h1>
        </div>
      ) : state === "error" ? (
        <div className="tv-center">
          <h1 role="alert">{error}</h1>
          <button
            type="button"
            className="tv-btn"
            onClick={() => void initReceiver()}
          >
            <RotateCcw size={20} />
            {t("tv.retry")}
          </button>
        </div>
      ) : state === "ready" ? (
        <div className="tv-ready">
          <div className="tv-qr-box">
            <div ref={qrHost}>{!qrCanvas ? <p>…</p> : null}</div>
            <h2>{t("tv.scanTitle")}</h2>
            <p className="tv-code">
              {t("tv.sessionCode")}: <b>{passcode}</b>
            </p>
          </div>
          <div className="tv-instructions">
            <h3>
              <Monitor size={26} />
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
      ) : state === "receiving" || state === "verifying" ? (
        <div className="tv-center">
          <h1>
            {state === "verifying"
              ? ar
                ? "فحص محتوى الملف وتجهيزه…"
                : "Validating file content…"
              : status || t("tv.receiving")}
          </h1>
          <div className="tv-progress-track">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="tv-progress-text">
            {progress.received.toLocaleString()} /{" "}
            {progress.total.toLocaleString()} B · {percent}%
          </p>
        </div>
      ) : state === "complete" && file ? (
        <div className="tv-center tv-complete">
          <h1>{t("tv.complete")}</h1>
          <p className="tv-integrity">
            {checksum !== null
              ? ar
                ? "وصلت البايتات كاملة وتطابق CRC-32."
                : "All bytes received and CRC-32 matched."
              : ar
                ? "تم تحميل بيانات الملف وفحص حجمها."
                : "File bytes loaded and size checked."}
          </p>
          <p className="tv-library-status" role="status">
            {libraryLabels[libraryState]}
          </p>
          {signature !== "unsigned" ? (
            <p className="tv-signature-status">
              {signature === "valid-trusted"
                ? ar
                  ? "توقيع صحيح بمفتاح موثوق."
                  : "Valid signature, trusted key."
                : ar
                  ? "التوقيع صحيح رياضيًا، لكن هوية هذا المفتاح غير موثوقة على جهازك."
                  : "Valid signature, but this key identity is not trusted on your device."}
            </p>
          ) : null}
          {files.length > 1 ? (
            <div className="tv-file-list">
              {files.map((f, i) => (
                <button
                  type="button"
                  className="tv-btn tv-file-select"
                  key={i}
                  onClick={() => selectFile(i)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          ) : null}
          <ReceivedPlayer
            key={file.url}
            file={file}
            onSave={() =>
              saveReceivedFile(file, bytes.current[activeIndex.current].bytes)
            }
          />
          <button
            type="button"
            className="tv-btn tv-btn-ghost"
            onClick={() => void initReceiver()}
          >
            <RotateCcw size={20} />
            {t("tv.receiveAnother")}
          </button>
        </div>
      ) : null}
      {state !== "error" && error ? <p role="alert">{error}</p> : null}
      <details className="tv-diagnostics">
        <summary>
          {ar ? "تشخيص الاستقبال والتشغيل" : "Receive / playback diagnostics"} ·{" "}
          {VERSION}
        </summary>
        <p>
          {ar ? "الحالة" : "State"}: {state} · {progress.received}/
          {progress.total} B · CRC:{" "}
          {checksum === null ? "—" : checksum.toString(16).padStart(8, "0")}
        </p>
        <p>
          {ar ? "المكتبة" : "Library"}: {libraryLabels[libraryState]}
        </p>
        <p>
          Secure context: {String(secure)} · WebRTC: {String(compat?.webRtc)} ·
          IndexedDB: {String(compat?.indexedDb)} · download attribute:{" "}
          {String(compat?.download)}
        </p>
        <p>
          {ar
            ? "ظهور خاصية download لا يضمن أن نظام التلفزيون يسمح بالتنزيل. مكتبة المتصفح قد تُحذف عند مسح بيانات الموقع أو نقص المساحة."
            : "A download attribute does not guarantee TV filesystem access. Browser storage can be cleared or evicted."}
        </p>
        <p>
          {ar
            ? "نوع MIME لا يغيّر ترميز الصوت. لو البيانات وصلت والتشغيل فشل، أرسل صورة هذه المعلومات وحالة المشغّل."
            : "MIME does not transcode audio. If receipt succeeds but playback fails, share these diagnostics and the player status."}
        </p>
        <p dir="ltr">{userAgent}</p>
      </details>
    </main>
  );
}
