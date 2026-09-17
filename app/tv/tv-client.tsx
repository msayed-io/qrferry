"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Monitor,
  RotateCcw,
  Smartphone,
  Trash2,
  Settings2,
  ShieldCheck,
  Activity,
  ChevronDown,
  ArrowLeftRight,
  Check,
  X,
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
  type StorageStage,
} from "@/lib/received-files-store";
import {
  unpackReceivedDelivery,
  receivedBlob,
  type ReceivedMediaFile,
  type ReceivedDelivery,
} from "@/lib/received-media";
import { getTrustedKeys } from "@/lib/identity-store";
import { saveReceivedFile, ReceivedDownloads } from "@/lib/save-received-file";
import {
  ReceivedPlayer,
  type DisplayFile,
  type PlayerSnapshot,
} from "./received-player";

import {
  BrowserOperationTimeout,
  describeBrowserError,
  withDeadline,
} from "@/lib/browser-operation";
import "./tv.css";

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
  "starting" | "ready" | "receiving" | "verifying" | "complete" | "error";
type LibraryState =
  "idle" | "saving" | "saved" | "failed" | "unconfirmed" | "loaded";
const VERSION = "TV-RECEIVE-4";
const AUTO_DOWNLOAD_KEY = "qrferry-tv-auto-download-v1";

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
  const [selectedIndex, setSelectedIndex] = useState(0);
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
  const [downloads] = useState(() => new ReceivedDownloads());
  const autoDownloadEnabled = useRef(true);
  const [autoDownload, setAutoDownload] = useState(true);
  const [autoResult, setAutoResult] = useState<{
    requested: number;
    unsupported: number;
    failed: number;
  } | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [storeStage, setStoreStage] = useState<StorageStage | null>(null);
  const [storageSeconds, setStorageSeconds] = useState(0);
  const [playerSnapshot, setPlayerSnapshot] = useState<PlayerSnapshot | null>(
    null,
  );
  const [trace, setTrace] = useState<Array<{ id: number; event: string }>>([]);
  const sequence = useRef(0);
  const log = useCallback((event: string) => {
    const id = ++sequence.current;
    setTrace((previous) => [...previous.slice(-11), { id, event }]);
  }, []);
  const onPlayerSnapshot = useCallback(
    (snapshot: PlayerSnapshot) => {
      setPlayerSnapshot(snapshot);
      if (snapshot.event !== "poll")
        log(
          `media:${snapshot.event} · ready=${snapshot.ready} · network=${snapshot.network}${snapshot.error ? ` · error=${snapshot.error}` : ""}`,
        );
    },
    [log],
  );
  useEffect(() => {
    document.documentElement.classList.add("qrferry-tv");
    return () => document.documentElement.classList.remove("qrferry-tv");
  }, []);
  useEffect(() => {
    if (libraryState !== "saving") return;
    const started = Date.now();
    const timer = setInterval(
      () => setStorageSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [libraryState]);

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
      setSelectedIndex(index);
      setPlayerSnapshot(null);
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
      setAutoResult(null);
      setStoreStage(null);
      setStorageSeconds(0);
      setTrace([]);
      setState("verifying");
      setError("");
      setLibraryError("");
      setLibraryState("idle");
      try {
        const delivery = await unpackReceivedDelivery(
          incoming,
          await withDeadline(getTrustedKeys(), "trusted-keys", 5000).catch(
            () => [],
          ),
        );
        if (!current()) return;
        setChecksum(incoming.checksum ?? null);
        displayDelivery(delivery);
        // Only newly received, verified deliveries. Never a render effect or a library reopen.
        // A failed/blocked download must not interrupt playback or browser-library persistence.
        if (autoDownloadEnabled.current) {
          const result = { requested: 0, unsupported: 0, failed: 0 };
          for (const received of delivery.files) {
            try {
              result[downloads.request(received)]++;
            } catch {
              result.failed++;
            }
          }
          setAutoResult(result);
        }
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
            await storeReceivedFile(f, (event) => {
              if (!current()) return;
              setStoreStage(event);
              log(
                `library:${event.phase}:${event.state} · ${event.elapsedMs} ms${event.error ? ` · ${event.error}` : ""}`,
              );
            });
          }
          if (!current()) return;
          setLibraryState("saved");
          try {
            setLibrary(await listReceivedFiles(50));
          } catch (cause) {
            if (current())
              setLibraryError(
                (ar
                  ? "حُفظ الملف، لكن تعذّر تحديث القائمة: "
                  : "Saved, but library refresh failed: ") +
                  describeBrowserError(cause),
              );
          }
        } catch (cause) {
          if (!current()) return;
          setLibraryState(
            cause instanceof BrowserOperationTimeout ? "unconfirmed" : "failed",
          );
          setLibraryError(
            (cause instanceof BrowserOperationTimeout
              ? ar
                ? "لم يتأكد حفظ المكتبة في الوقت المحدد. لا تمسح البيانات؛ الملف ما زال متاحًا في هذه الصفحة. "
                : "Library save was not confirmed in time. Do not clear data; the file is still available in this page. "
              : ar
                ? "تعذّر حفظ المكتبة. يمكنك الاستمرار في التشغيل. "
                : "Library save failed. Playback remains available. ") +
              describeBrowserError(cause),
          );
        }
      } catch (cause) {
        if (current()) {
          setState("error");
          setError(describeBrowserError(cause));
        }
      }
    },
    [ar, displayDelivery, downloads, log],
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
    setAutoResult(null);
    setStoreStage(null);
    setStorageSeconds(0);
    setPlayerSnapshot(null);
    setTrace([]);
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
      try {
        const enabled = localStorage.getItem(AUTO_DOWNLOAD_KEY) !== "false";
        autoDownloadEnabled.current = enabled;
        setAutoDownload(enabled);
      } catch {
        /* Default on for this session when preferences are unavailable. */
      }
      void initReceiver();
      void listReceivedFiles(50)
        .then((rows) => {
          if (!cancelled) setLibrary(rows);
        })
        .catch((cause) => {
          if (!cancelled)
            setLibraryError(
              (ar ? "المكتبة غير متاحة: " : "Library unavailable: ") +
                describeBrowserError(cause),
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
      downloads.dispose();
      bytes.current = [];
    };
  }, [ar, initReceiver, releaseUrl, invalidatePendingWork, downloads]);
  useEffect(() => {
    if (qrCanvas && qrHost.current) qrHost.current.replaceChildren(qrCanvas);
  }, [qrCanvas]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (
        ["Escape", "BrowserBack"].includes(event.key) ||
        [461, 10009].includes(event.keyCode)
      ) {
        if (showSettings || showLibrary || showDiagnostics) {
          event.preventDefault();
          const selector = showSettings
            ? ".tv-settings-button"
            : showLibrary
              ? ".tv-library-btn"
              : ".tv-diagnostics-toggle";
          setShowSettings(false);
          setShowLibrary(false);
          setShowDiagnostics(false);
          document.querySelector<HTMLButtonElement>(selector)?.focus();
        }
        return;
      }
      if (event.key === "Enter" && active?.matches('input[type="checkbox"]')) {
        event.preventDefault();
        active.click();
        return;
      }
      if (event.key === "MediaPlayPause") {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>(".tv-play-button")?.click();
        return;
      }
      if (active?.matches('input:not([type="checkbox"]),audio,video')) return;
      if (
        !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)
      )
        return;
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".tv-page button:not(:disabled), .tv-page a[href], .tv-page input:not(:disabled)",
        ),
      ).filter(
        (el) =>
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== "hidden",
      );
      if (!elements.length) return;
      event.preventDefault();
      let target = elements[0];
      if (active && elements.includes(active)) {
        const rect = active.getBoundingClientRect(),
          x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2;
        const horizontal =
          event.key === "ArrowLeft" || event.key === "ArrowRight";
        const sign =
          event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        let best = Infinity;
        target = active;
        for (const el of elements) {
          if (el === active) continue;
          const box = el.getBoundingClientRect(),
            dx = box.x + box.width / 2 - x,
            dy = box.y + box.height / 2 - y;
          const distance = (horizontal ? dx : dy) * sign;
          if (distance < 2) continue;
          // Prefer the same visual row/column before diagonal candidates.
          const inBeam = horizontal
            ? box.top < rect.bottom && box.bottom > rect.top
            : box.left < rect.right && box.right > rect.left;
          const score =
            (inBeam ? 0 : 100_000) +
            distance +
            Math.abs(horizontal ? dy : dx) * 2;
          if (score < best) {
            best = score;
            target = el;
          }
        }
      }
      target.focus();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, showLibrary, showDiagnostics]);
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
    setAutoResult(null);
    try {
      const data = await loadReceivedFileBytes(entry.id);
      if (!data)
        throw new Error(
          ar ? "الملف لم يعد موجودًا." : "File no longer available.",
        );
      const delivery = await unpackReceivedDelivery(
        { ...entry, bytes: new Uint8Array(data) },
        await withDeadline(getTrustedKeys(), "trusted-keys", 5000).catch(
          () => [],
        ),
      );
      if (gen !== generation.current || job !== deliveryJob.current) return;
      displayDelivery(delivery);
      setShowLibrary(false);
      setChecksum(null);
      setLibraryState("loaded");
      setError("");
    } catch (cause) {
      setLibraryError(describeBrowserError(cause));
    }
  };
  const removeFromLibrary = async (id: string) => {
    try {
      await deleteReceivedFile(id);
      setLibrary(await listReceivedFiles(50));
    } catch (cause) {
      setLibraryError(describeBrowserError(cause));
    }
  };
  const percent = progress.total
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : 0;
  const libraryLabels = {
    idle: ar ? "لم يبدأ" : "Not started",
    saving: ar ? "جارٍ الحفظ داخل المتصفح…" : "Saving in browser…",
    saved: ar ? "حُفظ في مكتبة المتصفح." : "Saved in the browser library.",
    failed: ar
      ? "فشل الحفظ المحلي؛ لا تغلق الصفحة."
      : "Local save failed; keep this page open.",
    unconfirmed: ar
      ? "لم يتأكد الحفظ — انتهت مهلة الانتظار."
      : "Save unconfirmed — waiting deadline reached.",
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
  const stateLabels: Record<TvState, string> = ar
    ? {
        starting: "تجهيز الشاشة",
        ready: "جاهز للاستقبال",
        receiving: "جارٍ الاستقبال",
        verifying: "التحقق من الملف",
        complete: "ملف جاهز",
        error: "تحتاج إلى مراجعة",
      }
    : {
        starting: "Starting",
        ready: "Ready to receive",
        receiving: "Receiving",
        verifying: "Verifying",
        complete: "File ready",
        error: "Check connection",
      };
  const libraryText = libraryLabels[libraryState];
  const phaseText =
    storeStage?.phase === "open"
      ? ar
        ? "فتح المكتبة"
        : "Opening library"
      : ar
        ? "كتابة الملف"
        : "Writing file";
  return (
    <main className={`tv-page tv-state-${state}`}>
      <header className="tv-header">
        <div className="tv-brand">
          <span className="tv-brand-mark">
            <ArrowLeftRight size={26} />
          </span>
          <div>
            <span className="tv-logo">QRFerry</span>
            <span className="tv-tag">{VERSION}</span>
          </div>
        </div>
        <div className="tv-header-status">
          <span
            className={`tv-status-dot ${state === "ready" || state === "complete" ? "is-live" : ""}`}
          />
          {stateLabels[state]}
        </div>
        <nav
          className="tv-header-actions"
          aria-label={ar ? "أدوات الاستقبال" : "Receiver tools"}
        >
          <button
            type="button"
            className="tv-btn tv-btn-ghost tv-library-btn"
            aria-expanded={showLibrary}
            aria-controls="tv-library-panel"
            onClick={() => {
              setShowLibrary((v) => !v);
              setShowSettings(false);
              void listReceivedFiles(50)
                .then(setLibrary)
                .catch((cause) => setLibraryError(describeBrowserError(cause)));
            }}
          >
            <FolderOpen size={21} />
            {ar ? "الملفات المستلمة" : "Received files"}
            {library.length ? (
              <span className="tv-count">{library.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="tv-btn tv-btn-ghost tv-settings-button"
            aria-expanded={showSettings}
            aria-controls="tv-settings-panel"
            onClick={() => {
              setShowSettings((v) => !v);
              setShowLibrary(false);
            }}
          >
            <Settings2 size={21} />
            <span>{ar ? "الإعدادات" : "Settings"}</span>
          </button>
        </nav>
      </header>
      {showSettings ? (
        <section
          className="tv-panel tv-settings-panel"
          id="tv-settings-panel"
          aria-label={ar ? "إعدادات الاتصال" : "Connection settings"}
        >
          <div className="tv-panel-title">
            <h2>{ar ? "إعدادات الاتصال" : "Connection settings"}</h2>
            <button
              type="button"
              className="tv-btn tv-btn-ghost"
              aria-label={ar ? "إغلاق الإعدادات" : "Close settings"}
              onClick={() => {
                setShowSettings(false);
                document
                  .querySelector<HTMLButtonElement>(".tv-settings-button")
                  ?.focus();
              }}
            >
              <X size={20} />
            </button>
          </div>
          <div className="tv-signal-host">
            <label htmlFor="tv-signal-input">{t("tv.signalHost")}</label>
            <div className="tv-input-row">
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
                className="tv-btn tv-primary tv-signal-apply"
                onClick={applySignal}
              >
                {t("tv.signalApply")}
              </button>
            </div>
            {signalApplied ? (
              <span className="tv-signal-applied">{t("tv.signalApplied")}</span>
            ) : null}
            <p className="tv-hint">{t("tv.signalHint")}</p>
            <p className="tv-signaling" dir="ltr">
              {signalingHost}
            </p>
          </div>
        </section>
      ) : null}
      {showLibrary ? (
        <section
          className="tv-panel tv-library"
          id="tv-library-panel"
          aria-label={ar ? "مكتبة المتصفح" : "Browser library"}
        >
          <div className="tv-panel-title">
            <div>
              <h2>{ar ? "مكتبة هذه الشاشة" : "This screen’s library"}</h2>
              <p className="tv-hint">
                {ar
                  ? "ملفات محفوظة داخل هذا المتصفح، وليست مجلد تنزيلات الجهاز."
                  : "Saved in this browser, separate from device Downloads."}
              </p>
            </div>
            <button
              type="button"
              className="tv-btn tv-btn-ghost"
              onClick={() => {
                setShowLibrary(false);
                document
                  .querySelector<HTMLButtonElement>(".tv-library-btn")
                  ?.focus();
              }}
            >
              <X size={20} />
              {ar ? "إغلاق المكتبة" : "Close library"}
            </button>
          </div>
          {!library.length ? (
            <p>
              {ar
                ? "لا توجد ملفات في المكتبة بعد."
                : "No files in this library yet."}
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
                    <FolderOpen size={22} />
                    <span className="tv-library-name">{f.name}</span>
                    <span className="tv-library-meta">
                      {(f.size / 1048576).toFixed(2)} MB
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tv-btn tv-btn-ghost tv-library-delete"
                    aria-label={ar ? "حذف" : "Delete"}
                    onClick={() => void removeFromLibrary(f.id)}
                  >
                    <Trash2 size={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <div className="tv-workspace">
        <section
          className="tv-panel tv-stage"
          aria-label={ar ? "مساحة الاستقبال" : "Receiver stage"}
        >
          {state === "starting" ? (
            <div className="tv-center">
              <Monitor size={48} />
              <h1>{t("tv.starting")}</h1>
              <p className="tv-hint">
                {ar
                  ? "نجهّز اتصالًا مباشرًا بين أجهزتك."
                  : "Preparing a direct connection between your devices."}
              </p>
            </div>
          ) : state === "error" ? (
            <div className="tv-center">
              <Activity size={44} />
              <h1>{ar ? "تعذّر تجهيز الاستقبال" : "Receiver unavailable"}</h1>
              <p role="alert" className="tv-alert">
                {error}
              </p>
              <button
                type="button"
                className="tv-btn tv-primary"
                onClick={() => void initReceiver()}
              >
                <RotateCcw size={20} />
                {t("tv.retry")}
              </button>
            </div>
          ) : state === "ready" ? (
            <div className="tv-ready">
              <div className="tv-qr-box">
                <div className="tv-qr-canvas" ref={qrHost}>
                  {!qrCanvas ? <p>…</p> : null}
                </div>
                <h2>{t("tv.scanTitle")}</h2>
                <p className="tv-code">
                  {t("tv.sessionCode")} <b dir="ltr">{passcode}</b>
                </p>
              </div>
              <div className="tv-instructions">
                <span className="tv-eyebrow">
                  {ar ? "من هاتفك إلى شاشتك" : "FROM PHONE TO SCREEN"}
                </span>
                <h1>
                  {ar
                    ? "ملفاتك هنا.\nبخطوات بسيطة."
                    : "Your files.\nOn the big screen."}
                </h1>
                <ol className="tv-steps">
                  <li data-n="1">{t("tv.how1")}</li>
                  <li data-n="2">{t("tv.how2")}</li>
                  <li data-n="3">{t("tv.how3")}</li>
                </ol>
                <p className="tv-hint">{t("tv.sameNetwork")}</p>
              </div>
            </div>
          ) : state === "receiving" || state === "verifying" ? (
            <div className="tv-center tv-transfer-stage">
              <span className="tv-transfer-icon">
                <DownloadIcon />
              </span>
              <span className="tv-eyebrow">
                {ar ? "اتصال مباشر" : "DIRECT TRANSFER"}
              </span>
              <h1>
                {state === "verifying"
                  ? ar
                    ? "نتحقق من محتوى الملف"
                    : "Verifying file content"
                  : t("tv.receiving")}
              </h1>
              <strong className="tv-transfer-percent">
                {percent}
                <small>%</small>
              </strong>
              <div className="tv-progress-track">
                <span style={{ width: `${percent}%` }} />
              </div>
              <p className="tv-progress-text">
                {progress.received.toLocaleString()} /{" "}
                {progress.total.toLocaleString()} B · {percent}%
              </p>
            </div>
          ) : state === "complete" && file ? (
            <div className="tv-complete">
              <div className="tv-complete-heading">
                <span className="tv-success-icon">
                  <Check size={22} />
                </span>
                <div>
                  <h1>{t("tv.complete")}</h1>
                  <p className="tv-integrity">
                    {checksum !== null
                      ? ar
                        ? "وصلت البايتات كاملة وتطابق CRC-32."
                        : "All bytes received; CRC-32 matched."
                      : ar
                        ? "فُتح الملف من مكتبة المتصفح."
                        : "Opened from the browser library."}
                  </p>
                </div>
                <button
                  type="button"
                  className="tv-btn tv-btn-ghost tv-receive-another"
                  onClick={() => void initReceiver()}
                >
                  <RotateCcw size={19} />
                  {t("tv.receiveAnother")}
                </button>
              </div>
              {signature !== "unsigned" ? (
                <p className="tv-signature-status">
                  {signature === "valid-trusted"
                    ? ar
                      ? "توقيع صحيح بمفتاح موثوق."
                      : "Verified signature, trusted key."
                    : ar
                      ? "توقيع صحيح، لكن المفتاح غير موثوق على هذه الشاشة."
                      : "Valid signature; key not trusted on this screen."}
                </p>
              ) : null}
              {files.length > 1 ? (
                <div className="tv-file-list">
                  {files.map((f, i) => (
                    <button
                      type="button"
                      className="tv-btn tv-file-select"
                      aria-pressed={i === selectedIndex}
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
                onSnapshot={onPlayerSnapshot}
                onDownload={() =>
                  downloads.request(bytes.current[activeIndex.current])
                }
                onSave={() =>
                  saveReceivedFile(
                    file,
                    bytes.current[activeIndex.current].bytes,
                  )
                }
              />
            </div>
          ) : null}
        </section>
        <aside className="tv-rail">
          <section
            className="tv-panel tv-diagnostics"
            aria-label={ar ? "حالة العمليات الفعلية" : "Live operation status"}
          >
            <div className="tv-panel-title">
              <h2>
                <Activity size={21} />
                {ar ? "حالة العمليات" : "Live status"}
              </h2>
              <span className="tv-live-label">{ar ? "مباشر" : "LIVE"}</span>
            </div>
            <div className="tv-operation">
              <span className="tv-operation-number">01</span>
              <div>
                <h3>{ar ? "استقبال البيانات" : "Receipt"}</h3>
                <p>{stateLabels[state]}</p>
                {progress.total ? (
                  <small dir="ltr">
                    {progress.received.toLocaleString()} /{" "}
                    {progress.total.toLocaleString()} B
                  </small>
                ) : null}
              </div>
            </div>
            <div className={`tv-operation tv-library-${libraryState}`}>
              <span className="tv-operation-number">02</span>
              <div>
                <h3>{ar ? "مكتبة المتصفح" : "Browser library"}</h3>
                <p className="tv-library-status" role="status">
                  {libraryText}
                </p>
                {libraryState === "saving" ? (
                  <small className="tv-storage-stage">
                    {phaseText} · {storageSeconds} {ar ? "ث" : "s"}
                  </small>
                ) : null}
                {storeStage && libraryState !== "saving" ? (
                  <small className="tv-storage-stage" dir="ltr">
                    {storeStage.phase} / {storeStage.state} ·{" "}
                    {storeStage.elapsedMs} ms
                  </small>
                ) : null}
              </div>
            </div>
            <div className="tv-operation">
              <span className="tv-operation-number">03</span>
              <div>
                <h3>{ar ? "قراءة الوسائط" : "Media readiness"}</h3>
                <p>
                  {!playerSnapshot
                    ? ar
                      ? "في انتظار ملف وسائط"
                      : "Waiting for media"
                    : playerSnapshot.error
                      ? `MEDIA_ERR_${playerSnapshot.error}`
                      : playerSnapshot.ready >= 3
                        ? ar
                          ? "بيانات متاحة للمشغّل"
                          : "Media data available"
                        : ar
                          ? "لم تكتمل جاهزية المشغّل"
                          : "Media not yet ready"}
                </p>
                {playerSnapshot ? (
                  <small className="tv-media-metrics" dir="ltr">
                    ready={playerSnapshot.ready} · network=
                    {playerSnapshot.network} · {playerSnapshot.time.toFixed(1)}s
                  </small>
                ) : null}
              </div>
            </div>
            {libraryError ? (
              <p className="tv-storage-error" role="alert">
                {libraryError}
              </p>
            ) : null}
            {state !== "error" && error ? (
              <p className="tv-alert" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="tv-text-button tv-diagnostics-toggle"
              aria-expanded={showDiagnostics}
              aria-controls="tv-diagnostics-extra"
              onClick={() => setShowDiagnostics((v) => !v)}
            >
              <ChevronDown size={16} />
              {ar ? "التفاصيل التقنية" : "Technical details"}
            </button>
            {showDiagnostics ? (
              <div id="tv-diagnostics-extra" className="tv-diagnostics-extra">
                <p>
                  {ar
                    ? "سجل أحداث هذه الجلسة، وليس فحصًا محاكى."
                    : "Events from this session, not a simulated check."}
                </p>
                <ol className="tv-event-log" dir="ltr">
                  {trace.length ? (
                    trace.map((e) => <li key={e.id}>{e.event}</li>)
                  ) : (
                    <li>
                      {ar
                        ? "لم تبدأ عمليات ملف بعد."
                        : "No file operations yet."}
                    </li>
                  )}
                </ol>
                <p>{status}</p>
                <p dir="ltr">
                  CRC:{" "}
                  {checksum === null
                    ? "—"
                    : checksum.toString(16).padStart(8, "0")}
                </p>
                <p dir="ltr">
                  Secure: {String(secure)} · WebRTC: {String(compat?.webRtc)} ·
                  IndexedDB API: {String(compat?.indexedDb)}
                </p>
                <p dir="ltr" className="tv-user-agent">
                  {userAgent}
                </p>
                <p className="tv-hint">
                  {ar
                    ? "وجود API لا يضمن عمل التخزين أو التنزيل. انتهاء المهلة يعني غياب تأكيد، وليس إثباتًا أن الملف لم يُكتب."
                    : "API presence does not guarantee access. A timeout means no confirmation, not proof that no file was written."}
                </p>
              </div>
            ) : null}
          </section>
          <section className="tv-panel tv-auto-download">
            <label>
              <input
                type="checkbox"
                checked={autoDownload}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  autoDownloadEnabled.current = enabled;
                  setAutoDownload(enabled);
                  try {
                    localStorage.setItem(AUTO_DOWNLOAD_KEY, String(enabled));
                  } catch {
                    /* Session preference applies. */
                  }
                }}
              />
              <span>
                {ar
                  ? "تنزيل تلقائي عند الاستلام"
                  : "Automatically download received files"}
              </span>
            </label>
            <p className="tv-hint">
              {ar
                ? "طلب تنزيل فقط؛ المتصفح يقرر السماح والحفظ."
                : "A download request only; the browser controls permission and saving."}
            </p>
            {autoResult ? (
              <p className="tv-auto-status" role="status">
                {ar
                  ? `طلبات التنزيل التلقائي: ${autoResult.requested}. غير مدعوم: ${autoResult.unsupported}. تعذّر الطلب: ${autoResult.failed}. هذا ليس تأكيدًا لحفظ الملفات.`
                  : `Download requests: ${autoResult.requested}. Unsupported: ${autoResult.unsupported}. Failed: ${autoResult.failed}. Not a confirmed disk save.`}
              </p>
            ) : null}
          </section>
        </aside>
      </div>
      <footer className="tv-footer">
        <span>
          <ShieldCheck size={17} />
          {ar ? "نقل مباشر بين أجهزتك" : "Direct device-to-device transfer"}
        </span>
        <span>
          {ar
            ? "الأسهم للتنقّل · OK للاختيار"
            : "Arrows to navigate · OK to select"}
        </span>
        <b dir="ltr">{VERSION}</b>
      </footer>
    </main>
  );
}
function DownloadIcon() {
  return <ArrowLeftRight size={34} />;
}
