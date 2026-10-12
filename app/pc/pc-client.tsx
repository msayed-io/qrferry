"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Camera,
  Check,
  Copy,
  Download,
  Monitor,
  Paperclip,
  QrCode,
  ScanLine,
  Send,
  Unplug,
} from "lucide-react";
import { flushSync } from "react-dom";
import { useI18n } from "../lang-provider";
import { WorkspaceHeader } from "../workspace-ui";
import {
  BRIDGE_MAX_CHAT_CHARS,
  type BridgeChatMessage,
  type BridgeFileItem,
  type BridgeStatus,
} from "@/lib/bridge-channel";
import {
  BRIDGE_PATH,
  bridgeShareUrl,
  decodeBridgePairing,
  type BridgePairing,
} from "@/lib/bridge-pairing";
import {
  joinBridge,
  openBridgeHost,
  type BridgeHandle,
  type BridgeHostHandle,
  type BridgeHostState,
} from "@/lib/bridge-session";
import { formatBytes, MAX_FILE_BYTES } from "@/lib/optical-transfer";
import { receivedBlob } from "@/lib/received-media";
import { renderRawQr } from "@/lib/qr-renderer";
import "./pc.css";

declare global {
  interface Window {
    __qrferryTestMode?: boolean;
    __qrferryBridge?: {
      peerId?: string;
      payload?: string;
      url?: string;
      chats: { direction: "in" | "out"; text: string }[];
      received: { name: string; size: number; mime: string; bytes: number[] }[];
    };
    __qrferryBridgeModules?: { n: number; data: number[] };
  }
}

type Phase = "home" | "hosting" | "scanning" | "connecting" | "connected";
type Role = "host" | "joiner";
type Item = BridgeChatMessage | BridgeFileItem;
type Tx = (ar: string, en: string) => string;

const QR_SCALE = 7;
const SCAN_SIZE = 640;
const SCAN_INTERVAL_MS = 120;
/** سعة QR بمستوى تصحيح M (بالبايت) لكل إصدار، لاختيار أصغر إصدار يكفي الرابط. */
const QR_CAPACITY_M: ReadonlyArray<readonly [version: number, bytes: number]> = [
  [10, 216],
  [11, 254],
  [12, 290],
  [13, 334],
  [14, 365],
  [15, 415],
  [16, 453],
];

function qrVersionFor(byteLength: number): number {
  const hit = QR_CAPACITY_M.find(([, capacity]) => byteLength <= capacity);
  if (!hit) throw new Error("رابط الربط أطول من سعة رمز QR.");
  return hit[0];
}

/** يضيف الرسالة، أو يحدّث الملف الموجود بنفس المعرّف والاتجاه. */
function upsertItem(list: Item[], item: Item): Item[] {
  const index = list.findIndex(
    (existing) =>
      existing.kind === item.kind &&
      existing.direction === item.direction &&
      (item.kind === "chat" || existing.id === item.id),
  );
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fileStatusText(item: BridgeFileItem, tx: Tx): string {
  switch (item.status) {
    case "queued":
      return tx("في الانتظار", "Queued");
    case "waiting":
      return tx("بانتظار الطرف الآخر", "Waiting for the other side");
    case "sending":
      return tx("جارٍ الإرسال", "Sending");
    case "receiving":
      return tx("جارٍ الاستقبال", "Receiving");
    case "done":
      return tx("تم", "Done");
    case "failed":
      return tx("فشل", "Failed");
  }
}

function isTestMode(): boolean {
  return typeof window !== "undefined" && window.__qrferryTestMode === true;
}

function BridgeMediaPreview({
  item,
  alt,
}: {
  item: BridgeFileItem;
  alt: string;
}) {
  const [url] = useState<string | null>(() =>
    item.bytes && /^(image|audio|video)\//i.test(item.mime)
      ? URL.createObjectURL(receivedBlob(item.bytes, item.mime))
      : null,
  );

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!url) return null;
  if (item.mime.toLowerCase().startsWith("image/")) {
    // Blob URLs are local peer-to-peer media and cannot use next/image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="bridge-media-image" src={url} alt={alt} />;
  }
  if (item.mime.toLowerCase().startsWith("video/")) {
    return <video className="bridge-media-video" src={url} controls preload="metadata" />;
  }
  return <audio className="bridge-media-audio" src={url} controls preload="metadata" />;
}

export function BridgeClient() {
  const { lang } = useI18n();
  const tx: Tx = (ar, en) => (lang === "ar" ? ar : en);

  const [phase, setPhase] = useState<Phase>("home");
  const [role, setRole] = useState<Role | null>(null);
  const [hostState, setHostState] = useState<BridgeHostState>("starting");
  const [hostDetail, setHostDetail] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [qrImage, setQrImage] = useState<ImageData | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [scanError, setScanError] = useState("");
  const [notice, setNotice] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);

  const hostRef = useRef<BridgeHostHandle | null>(null);
  const activeRef = useRef<BridgeHandle | null>(null);
  /** يزداد مع كل جلسة جديدة؛ أي حدث من جلسة قديمة يُتجاهل. */
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const autoJoinedRef = useRef(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);
  const scanCountRef = useRef(0);
  /** يزداد مع كل إيقاف للكاميرا، فيُغلق أي تدفق يصل بعد الإلغاء. */
  const cameraTokenRef = useRef(0);
  const localTypingRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- الكاميرا ----------

  const stopCamera = () => {
    cameraTokenRef.current += 1;
    scanningRef.current = false;
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // ---------- إدارة الجلسة ----------

  /** يفكّ الموارد الحالية (كاميرا واتصالات) دون تغيير رقم الجلسة. */
  const releaseHandles = () => {
    stopCamera();
    const host = hostRef.current;
    const active = activeRef.current;
    hostRef.current = null;
    activeRef.current = null;
    try {
      host?.destroy();
      if (active !== host) active?.destroy();
    } catch {
      // مغلق مسبقاً.
    }
  };

  /** يبطل أحداث الجلسة الحالية ثم يفكّ مواردها. */
  const endSession = () => {
    generationRef.current += 1;
    releaseHandles();
  };

  /** أحداث جلسة بعينها؛ تُتجاهل إن بدأت جلسة أحدث أو فُكّ التركيب. */
  const sessionEvents = (generation: number) => {
    const live = () => mountedRef.current && generation === generationRef.current;
    return {
      onStatus(status: BridgeStatus, detail?: string) {
        if (!live()) return;
        if (status === "connected") {
          setPhase("connected");
          setNotice("");
          setJoinError("");
          return;
        }
        if (status === "authenticating") return;
        if (hostRef.current) {
          // المضيف يبقى مستمعاً؛ onHostState يعيده إلى الانتظار.
          setNotice(detail ?? tx("انقطع الاتصال.", "The connection closed."));
          return;
        }
        // الضيف: الاتصال انتهى. نعود للرئيسية، ويبقى السجل متاحاً للتنزيل.
        const stale = activeRef.current;
        activeRef.current = null;
        try {
          stale?.destroy();
        } catch {
          // مغلق مسبقاً.
        }
        setPhase("home");
        setRole(null);
        setJoinError(detail ?? tx("انقطع الاتصال.", "The connection closed."));
      },
      onChat(message: BridgeChatMessage) {
        if (live()) setItems((list) => upsertItem(list, message));
      },
      onFile(item: BridgeFileItem) {
        if (live()) setItems((list) => upsertItem(list, item));
      },
      onTyping(typing: boolean) {
        if (!live()) return;
        setRemoteTyping(typing);
        if (remoteTypingTimerRef.current) clearTimeout(remoteTypingTimerRef.current);
        if (typing) {
          remoteTypingTimerRef.current = setTimeout(() => {
            setRemoteTyping(false);
            remoteTypingTimerRef.current = null;
          }, 2600);
        }
      },
      onHostState(state: BridgeHostState, detail?: string) {
        if (!live()) return;
        setHostState(state);
        setHostDetail(detail ?? "");
        if (state === "connected") {
          setPhase("connected");
          setNotice("");
        } else if (state === "waiting") {
          setPhase((current) => (current === "connected" ? "hosting" : current));
          setNotice(detail ?? "");
        }
      },
    };
  };

  const startHosting = async () => {
    endSession();
    setRole("host");
    setPhase("hosting");
    setHostState("starting");
    setHostDetail("");
    setJoinError("");
    setScanError("");
    setNotice("");
    setCopied(false);
    setQrImage(null);
    const generation = generationRef.current;
    const events = sessionEvents(generation);
    try {
      const handle = await openBridgeHost(events);
      if (generation !== generationRef.current || !mountedRef.current) {
        handle.destroy();
        return;
      }
      hostRef.current = handle;
      activeRef.current = handle;
      const url = bridgeShareUrl(window.location.origin, handle.payload);
      const bytes = new TextEncoder().encode(url);
      const image = await renderRawQr(bytes, qrVersionFor(bytes.length), "M", QR_SCALE);
      if (generation !== generationRef.current || !mountedRef.current) return;
      setShareUrl(url);
      setQrImage(image);
      setHostState("waiting");
      if (isTestMode()) {
        window.__qrferryBridge = {
          ...(window.__qrferryBridge ?? { chats: [], received: [] }),
          peerId: handle.peerId,
          payload: handle.payload,
          url,
        };
        // نفس مقياس الرسم تماماً، حتى تطابق مصفوفة الوحدات الصورة المعروضة.
        const n = Math.round(image.width / QR_SCALE);
        const data: number[] = [];
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            data.push(
              image.data[(y * QR_SCALE * image.width + x * QR_SCALE) * 4] < 128 ? 1 : 0,
            );
          }
        }
        window.__qrferryBridgeModules = { n, data };
      }
    } catch (error) {
      if (generation !== generationRef.current || !mountedRef.current) return;
      setHostState("error");
      setHostDetail(
        errorText(error, tx("تعذّر تجهيز رمز الربط.", "Could not prepare the pairing code.")),
      );
    }
  };

  const connectWith = async (pairing: BridgePairing) => {
    endSession();
    setRole("joiner");
    setPhase("connecting");
    setJoinError("");
    setScanError("");
    setNotice("");
    const generation = generationRef.current;
    try {
      const handle = await joinBridge(pairing, sessionEvents(generation));
      if (generation !== generationRef.current || !mountedRef.current) {
        handle.destroy();
        return;
      }
      activeRef.current = handle;
    } catch (error) {
      if (generation !== generationRef.current || !mountedRef.current) return;
      setPhase("home");
      setRole(null);
      setJoinError(
        errorText(error, tx("تعذّر الاتصال بالكمبيوتر.", "Could not reach the computer.")),
      );
    }
  };

  const disconnect = () => {
    endSession();
    setRole(null);
    setPhase("home");
    setNotice("");
    setRemoteTyping(false);
    localTypingRef.current = false;
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    if (remoteTypingTimerRef.current) clearTimeout(remoteTypingTimerRef.current);
    typingStopTimerRef.current = null;
    remoteTypingTimerRef.current = null;
  };

  // ---------- المسح بالكاميرا ----------

  const scanFrame = async (): Promise<void> => {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    const canvas = scanCanvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) {
      scanTimerRef.current = setTimeout(() => void scanFrame(), SCAN_INTERVAL_MS);
      return;
    }
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        const side = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - side) / 2;
        const sy = (video.videoHeight - side) / 2;
        context.drawImage(video, sx, sy, side, side, 0, 0, SCAN_SIZE, SCAN_SIZE);
        const image = context.getImageData(0, 0, SCAN_SIZE, SCAN_SIZE);
        // الوضع المتين أبطأ، لذا نستخدمه كل سادس إطار فقط.
        scanCountRef.current += 1;
        const robust = scanCountRef.current % 6 === 0;
        const { scanRawQr } = await import("@/lib/qr-scanner");
        const bytes = await scanRawQr(image, robust);
        if (!scanningRef.current) return;
        if (bytes) {
          const pairing = decodeBridgePairing(new TextDecoder().decode(bytes));
          if (pairing) {
            stopCamera();
            void connectWith(pairing);
            return;
          }
          setScanError(
            tx(
              "هذا الرمز ليس رمز ربط QRFerry. امسح الرمز المعروض على الكمبيوتر.",
              "This is not a QRFerry pairing code.",
            ),
          );
        }
      }
    } catch {
      // إطار غير صالح: نتجاهله ونكمل.
    }
    if (scanningRef.current) scanTimerRef.current = setTimeout(() => void scanFrame(), SCAN_INTERVAL_MS);
  };

  const startCamera = async () => {
    setScanError("");
    const token = cameraTokenRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError(
        tx(
          "الكاميرا غير متاحة في هذا المتصفح أو على اتصال غير آمن. يمكنك لصق الرابط يدوياً.",
          "Camera is unavailable in this browser or on an insecure connection. Paste the link instead.",
        ),
      );
      setPhase("home");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const video = videoRef.current;
      if (token !== cameraTokenRef.current || !mountedRef.current || !video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      scanningRef.current = true;
      void scanFrame();
    } catch (error) {
      setPhase("home");
      setScanError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? tx("لم يُسمح بالوصول إلى الكاميرا.", "Camera permission was denied.")
          : tx("تعذّر تشغيل الكاميرا.", "Could not start the camera."),
      );
    }
  };

  /** يفتح وضع المسح: يركّب عنصر الفيديو أولاً ثم يشغّل الكاميرا. */
  const openScanner = () => {
    setJoinError("");
    stopCamera();
    flushSync(() => setPhase("scanning"));
    void startCamera();
  };

  const cancelScanner = () => {
    stopCamera();
    setPhase("home");
  };

  // ---------- الإرسال والتنزيل ----------

  const ready = phase === "connected";

  const sendTypingState = (typing: boolean) => {
    const handle = activeRef.current;
    if (!handle?.isReady() || localTypingRef.current === typing) return;
    localTypingRef.current = typing;
    handle.sendTyping(typing);
  };

  const scheduleTypingStop = () => {
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      sendTypingState(false);
      typingStopTimerRef.current = null;
    }, 1800);
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!value.trim()) {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
      sendTypingState(false);
      return;
    }
    sendTypingState(true);
    scheduleTypingStop();
  };

  const sendChat = () => {
    const handle = activeRef.current;
    const text = draft.trim();
    if (!ready || !handle?.isReady() || !text) return;
    try {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
      sendTypingState(false);
      handle.sendChat(text.slice(0, BRIDGE_MAX_CHAT_CHARS));
      setDraft("");
      setNotice("");
    } catch (error) {
      setNotice(errorText(error, tx("تعذّر إرسال الرسالة.", "Could not send the message.")));
    }
  };

  const sendFiles = async (files: FileList | File[]) => {
    const handle = activeRef.current;
    if (!ready || !handle?.isReady()) {
      setNotice(tx("الاتصال غير جاهز بعد.", "The connection is not ready yet."));
      return;
    }
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setNotice(
          tx(
            `الملف ${file.name} أكبر من الحد المسموح (${formatBytes(MAX_FILE_BYTES)}).`,
            `${file.name} exceeds the ${formatBytes(MAX_FILE_BYTES)} limit.`,
          ),
        );
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!mountedRef.current || activeRef.current !== handle || !handle.isReady()) return;
        handle.sendFile({ name: file.name, mime: file.type, bytes });
      } catch (error) {
        setNotice(errorText(error, tx("تعذّر إرسال الملف.", "Could not send the file.")));
      }
    }
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) void sendFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void sendFiles(event.dataTransfer.files);
  };

  const downloadItem = (item: BridgeFileItem) => {
    if (!item.bytes) return;
    const url = URL.createObjectURL(receivedBlob(item.bytes, item.mime));
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  };

  const onPasteSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pairing = decodeBridgePairing(pasteValue);
    if (!pairing) {
      setJoinError(
        tx(
          "الرابط أو الرمز غير صالح. انسخ الرابط كاملاً من الكمبيوتر.",
          "Invalid link. Copy the full link from the computer.",
        ),
      );
      return;
    }
    setPasteValue("");
    void connectWith(pairing);
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice(tx("تعذّر النسخ. حدّد الرابط يدوياً.", "Copy failed. Select the link manually."));
    }
  };

  // ---------- دورة الحياة ----------

  // رسم صورة QR على الـ canvas بعد ظهوره في وضع المضيف.
  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (phase !== "hosting" || !qrImage || !canvas) return;
    canvas.width = qrImage.width;
    canvas.height = qrImage.height;
    canvas.getContext("2d")?.putImageData(qrImage, 0, 0);
  }, [phase, qrImage]);

  // واجهة الاختبار: تعكس الرسائل والملفات المستلمة بعد التحقق الكامل.
  useEffect(() => {
    if (!isTestMode()) return;
    const chats = items
      .filter((item): item is BridgeChatMessage => item.kind === "chat")
      .map((item) => ({ direction: item.direction, text: item.text }));
    const received = items
      .filter(
        (item): item is BridgeFileItem =>
          item.kind === "file" && item.direction === "in" && item.status === "done",
      )
      .map((item) => ({
        name: item.name,
        size: item.size,
        mime: item.mime,
        bytes: item.bytes ? Array.from(item.bytes) : [],
      }));
    window.__qrferryBridge = { ...(window.__qrferryBridge ?? {}), chats, received };
  }, [items]);

  // الاتصال التلقائي عند فتح الرابط المرفق بالرمز (#QFB1.…)، مرة واحدة فقط.
  useEffect(() => {
    mountedRef.current = true;
    if (!autoJoinedRef.current) {
      autoJoinedRef.current = true;
      const pairing = decodeBridgePairing(window.location.href);
      if (pairing) {
        window.history.replaceState(null, "", BRIDGE_PATH);
        // نؤجل بدء الاتصال إلى microtask خارج جسم الـ effect؛ لا يُضبط الحالة متزامناً داخله.
        queueMicrotask(() => void connectWith(pairing));
      }
    }
    return () => {
      // لا نغيّر رقم الجلسة هنا: في StrictMode يعاد التركيب فوراً ويجب أن يبقى الاتصال التلقائي صالحاً.
      mountedRef.current = false;
      releaseHandles();
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      if (remoteTypingTimerRef.current) clearTimeout(remoteTypingTimerRef.current);
    };
    // يعمل مرة عند التركيب والتفكيك فقط.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- العرض ----------

  const hasItems = items.length > 0;

  const timeline = (
    <ol className="bridge-timeline" aria-label={tx("سجل الجلسة", "Session log")}>
      {items.map((item) =>
        item.kind === "chat" ? (
          <li key={`chat-${item.direction}-${item.id}`} className={`bridge-bubble ${item.direction}`}>
            <p>{item.text}</p>
            <time dateTime={new Date(item.at).toISOString()}>
              {new Date(item.at).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </li>
        ) : (
          <li key={`file-${item.direction}-${item.id}`} className={`bridge-file ${item.direction}`}>
            <div className="bridge-file-main">
              <span className="bridge-file-name" title={item.name}>
                {item.name}
              </span>
              <small>
                {formatBytes(item.size)} · {item.direction === "out" ? tx("أُرسل", "Sent") : tx("استُقبل", "Received")}{" "}
                · {fileStatusText(item, tx)}
              </small>
              {(item.status === "sending" || item.status === "receiving") && (
                <progress
                  className="bridge-progress"
                  max={item.size || 1}
                  value={Math.min(item.progress, item.size || 1)}
                />
              )}
              {item.status === "done" && item.bytes && (
                <BridgeMediaPreview item={item} alt={item.name} />
              )}
              {item.error && <small className="bridge-file-error">{item.error}</small>}
            </div>
            {item.status === "done" && item.bytes && (
              <button
                type="button"
                className="bridge-icon-button"
                onClick={() => downloadItem(item)}
                aria-label={tx(`تنزيل ${item.name}`, `Download ${item.name}`)}
                title={tx("تنزيل", "Download")}
              >
                <Download size={18} aria-hidden="true" />
              </button>
            )}
          </li>
        ),
      )}
    </ol>
  );

  return (
    <>
      {phase !== "connected" && <WorkspaceHeader active="pc" />}
      <main className="transfer-page bridge-page" data-page="pc" data-phase={phase}>
      <section className="workspace-intro bridge-intro">
        <h1>{tx("اربط هاتفك بالكمبيوتر", "Link your phone and computer")}</h1>
        <p>
          {tx(
            "امسح رمز أحد الجهازين من الآخر، ثم أرسل رسائل وملفات في الاتجاهين. لا تمر البيانات بأي خادم.",
            "Scan one device's code from the other, then send messages and files both ways. Data never touches a server.",
          )}
        </p>
      </section>

      {phase === "home" && (
        <>
          <div className="bridge-grid">
            <article className="bridge-card">
              <Monitor size={28} aria-hidden="true" />
              <h2>{tx("اعرض رمز الربط من هنا", "Show the pairing code here")}</h2>
              <p>
                {tx(
                  "استخدم هذا على الكمبيوتر، ثم امسح الرمز بالهاتف.",
                  "Use this on the computer, then scan the code with your phone.",
                )}
              </p>
              <button type="button" className="primary-action" onClick={() => void startHosting()}>
                <QrCode size={18} aria-hidden="true" />
                <span>{tx("أنشئ رمز الربط", "Create pairing code")}</span>
              </button>
            </article>

            <article className="bridge-card">
              <ScanLine size={28} aria-hidden="true" />
              <h2>{tx("امسح رمز الكمبيوتر", "Scan the computer's code")}</h2>
              <p>
                {tx(
                  "استخدم هذا على الهاتف لمسح الرمز المعروض على الشاشة.",
                  "Use this on the phone to scan the code shown on the screen.",
                )}
              </p>
              <button
                type="button"
                className="primary-action"
                onClick={openScanner}
              >
                <Camera size={18} aria-hidden="true" />
                <span>{tx("افتح الكاميرا للمسح", "Open camera to scan")}</span>
              </button>
            </article>
          </div>

          <form className="bridge-paste" onSubmit={onPasteSubmit}>
            <label htmlFor="bridge-paste-input">
              {tx("أو الصق الرابط الذي يعرضه الكمبيوتر", "Or paste the link shown on the computer")}
            </label>
            <div className="bridge-paste-row">
              <input
                id="bridge-paste-input"
                type="text"
                dir="ltr"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://…/pc#QFB1."
                value={pasteValue}
                onChange={(event) => setPasteValue(event.target.value)}
              />
              <button type="submit" className="bridge-button" disabled={!pasteValue.trim()}>
                {tx("اتصل", "Connect")}
              </button>
            </div>
          </form>

          {(joinError || scanError) && (
            <p role="alert" className="bridge-error">
              {joinError || scanError}
            </p>
          )}

          {hasItems && (
            <section className="bridge-history" aria-label={tx("سجل الجلسة السابقة", "Previous session")}>
              <div className="bridge-section-head">
                <h2>{tx("آخر الرسائل والملفات", "Latest messages and files")}</h2>
                <button type="button" className="bridge-button ghost" onClick={() => setItems([])}>
                  {tx("مسح السجل", "Clear log")}
                </button>
              </div>
              {timeline}
            </section>
          )}

          <ol className="bridge-steps">
            <li>{tx("اعرض الرمز على أحد الجهازين.", "Show the code on one device.")}</li>
            <li>
              {tx(
                "امسحه من الجهاز الآخر، أو الصق الرابط.",
                "Scan it from the other device, or paste the link.",
              )}
            </li>
            <li>{tx("بعد الاتصال، أرسل في الاتجاهين.", "Once connected, send in both directions.")}</li>
          </ol>
        </>
      )}

      {phase === "hosting" && (
        <section className="bridge-panel" aria-live="polite">
          {qrImage && (
            <canvas
              ref={qrCanvasRef}
              className="bridge-qr-canvas"
              role="img"
              aria-label={tx("رمز ربط QRFerry", "QRFerry pairing code")}
            />
          )}
          {hostState === "starting" && <p>{tx("جارٍ تجهيز الرمز…", "Preparing the code…")}</p>}
          {hostState === "waiting" && (
            <>
              <p className="bridge-strong">{tx("امسح هذا الرمز بالهاتف", "Scan this code with your phone")}</p>
              <p className="bridge-muted">{tx("بانتظار الجهاز الآخر…", "Waiting for the other device…")}</p>
              {notice && <p className="bridge-muted">{notice}</p>}
            </>
          )}
          {hostState === "locked" && (
            <p role="alert" className="bridge-error">
              {tx(
                "أُوقف الاستماع بعد محاولات فاشلة متكررة. أنشئ رمزاً جديداً.",
                "Listening stopped after repeated failed attempts. Create a new code.",
              )}
            </p>
          )}
          {hostState === "error" && (
            <p role="alert" className="bridge-error">
              {hostDetail || tx("حدث خطأ.", "Something went wrong.")}
            </p>
          )}
          {shareUrl && hostState !== "error" && (
            <div className="bridge-link-row">
              <code dir="ltr">{shareUrl}</code>
              <button type="button" className="bridge-button" onClick={() => void copyShareUrl()}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                <span>{copied ? tx("تم النسخ", "Copied") : tx("انسخ الرابط", "Copy link")}</span>
              </button>
            </div>
          )}
          <button type="button" className="bridge-button ghost" onClick={disconnect}>
            {tx("إلغاء", "Cancel")}
          </button>
        </section>
      )}

      {phase === "scanning" && (
        <section className="bridge-panel">
          <div className="bridge-camera">
            <video ref={videoRef} muted playsInline aria-label={tx("معاينة الكاميرا", "Camera preview")} />
            <div className="bridge-camera-frame" aria-hidden="true" />
            <canvas ref={scanCanvasRef} width={SCAN_SIZE} height={SCAN_SIZE} hidden />
          </div>
          <p className="bridge-muted">
            {tx("وجّه الكاميرا نحو رمز الكمبيوتر", "Point the camera at the computer's code")}
          </p>
          {scanError && (
            <p role="alert" className="bridge-error">
              {scanError}
            </p>
          )}
          <button type="button" className="bridge-button ghost" onClick={cancelScanner}>
            {tx("إلغاء", "Cancel")}
          </button>
        </section>
      )}

      {phase === "connecting" && (
        <section className="bridge-panel" aria-live="polite">
          <p className="bridge-strong">{tx("جارٍ الاتصال والتحقق…", "Connecting and verifying…")}</p>
          <p className="bridge-muted">
            {tx(
              "لن يتم قبول أي بيانات قبل اكتمال التحقق.",
              "No data is accepted until verification completes.",
            )}
          </p>
          <button type="button" className="bridge-button ghost" onClick={disconnect}>
            {tx("إلغاء", "Cancel")}
          </button>
        </section>
      )}

      {phase === "connected" && (
        <section className="bridge-session" aria-label={tx("جلسة الاتصال", "Session")}>
          <div className="bridge-session-bar">
            <span className="bridge-status" role="status">
              <span className="bridge-dot" aria-hidden="true" />
              {tx("متصل", "Connected")}
              {role && (
                <small>
                  {" · "}
                  {role === "host"
                    ? tx("هذا الجهاز: الكمبيوتر", "This device: computer")
                    : tx("هذا الجهاز: الهاتف", "This device: phone")}
                </small>
              )}
              {remoteTyping && (
                <span className="bridge-typing-indicator" role="status" aria-live="polite">
                  <span className="bridge-typing-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {tx("يكتب الآن…", "typing…")}
                </span>
              )}
            </span>
            <button type="button" className="bridge-button ghost" onClick={disconnect}>
              <Unplug size={16} aria-hidden="true" />
              <span>{tx("قطع الاتصال", "Disconnect")}</span>
            </button>
          </div>

          {notice && (
            <p role="alert" className="bridge-error">
              {notice}
            </p>
          )}

          <div
            className={`bridge-drop${dragging ? " dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {hasItems ? (
              timeline
            ) : (
              <p className="bridge-muted bridge-empty">
                {tx(
                  "ابدأ بإرسال رسالة أو ملف. الملفات المستلمة تظهر هنا.",
                  "Start by sending a message or a file. Received files appear here.",
                )}
              </p>
            )}
          </div>

          <form
            className="bridge-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendChat();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,audio/*,video/*,*/*"
              hidden
              onChange={onPickFiles}
              tabIndex={-1}
            />
            <button
              type="button"
              className="bridge-icon-button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={tx("إرفاق ملف", "Attach file")}
              title={tx("إرفاق ملف", "Attach file")}
            >
              <Paperclip size={18} aria-hidden="true" />
            </button>
            <textarea
              rows={1}
              value={draft}
              maxLength={BRIDGE_MAX_CHAT_CHARS}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={onComposerKey}
              placeholder={tx("اكتب رسالة…", "Type a message…")}
              aria-label={tx("اكتب رسالة", "Type a message")}
            />
            <button type="submit" className="bridge-button" disabled={!draft.trim()} aria-label={tx("إرسال", "Send")}>
              <Send size={16} aria-hidden="true" />
              <span>{tx("إرسال", "Send")}</span>
            </button>
          </form>
          <p className="bridge-muted bridge-hint">
            {tx(
              `حد الملف ${formatBytes(MAX_FILE_BYTES)}. يمكنك أيضاً سحب الملفات وإفلاتها هنا.`,
              `File limit ${formatBytes(MAX_FILE_BYTES)}. You can also drag and drop files here.`,
            )}
          </p>
        </section>
      )}
      </main>
    </>
  );
}
