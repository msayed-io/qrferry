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
import { Glass } from "glisse";
import { usePathname } from "next/navigation";
import { DesignIcon } from "../design-icons";
import { Capsule, Card, CircleButton, CameraCorners, useBridgeView } from "../design-system";
import { createPortal, flushSync } from "react-dom";
import { useI18n } from "../lang-provider";
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
import {
  notifyBridgeIncoming,
  playBridgeNotificationTone,
  requestBridgeNotificationPermission,
} from "@/lib/bridge-notifications";

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
      existing.id === item.id,
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
  const pathname = usePathname();
  const { view, setView, connectionChanged } = useBridgeView();
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
  const [cameraRunning, setCameraRunning] = useState(false);

  const hostRef = useRef<BridgeHostHandle | null>(null);
  const activeRef = useRef<BridgeHandle | null>(null);
  /** يزداد مع كل جلسة جديدة؛ أي حدث من جلسة قديمة يُتجاهل. */
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const lastPairingRef = useRef<BridgePairing | null>(null);
  const lastActionRef = useRef<"host" | "camera" | "join">("host");
  const timelineRef = useRef<HTMLOListElement>(null);
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
  const notifiedIncomingRef = useRef(new Set<string>());

  const announceIncoming = (kind: "message" | "file", title: string, body: string) => {
    playBridgeNotificationTone(kind);
    notifyBridgeIncoming(title, body);
  };

  // ---------- الكاميرا ----------

  const stopCamera = () => {
    cameraTokenRef.current += 1;
    scanningRef.current = false;
    setCameraRunning(false);
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
    connectionChanged(false);
    releaseHandles();
  };

  /** أحداث جلسة بعينها؛ تُتجاهل إن بدأت جلسة أحدث أو فُكّ التركيب. */
  const sessionEvents = (generation: number) => {
    const live = () => mountedRef.current && generation === generationRef.current;
    return {
      onStatus(status: BridgeStatus, detail?: string) {
        if (!live()) return;
        if (status === "connected") {
          connectionChanged(true);
          setPhase("connected");
          setNotice("");
          setJoinError("");
          void requestBridgeNotificationPermission();
          return;
        }
        if (status === "authenticating") return;
        connectionChanged(false);
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
        if (!live()) return;
        setItems((list) => upsertItem(list, message));
        if (message.direction === "in") announceIncoming(
          "message",
          tx("رسالة جديدة · QRFerry", "New message · QRFerry"),
          message.text,
        );
      },
      onFile(item: BridgeFileItem) {
        if (!live()) return;
        setItems((list) => upsertItem(list, item));
        if (
          item.direction === "in" &&
          item.status === "done" &&
          !notifiedIncomingRef.current.has(item.id)
        ) {
          notifiedIncomingRef.current.add(item.id);
          announceIncoming(
            "file",
            tx("ملف جديد · QRFerry", "New file · QRFerry"),
            item.name,
          );
        }
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
          connectionChanged(true);
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
    lastActionRef.current = "host";
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
    lastPairingRef.current = pairing;
    lastActionRef.current = "join";
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
      setCameraRunning(true);
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
    lastActionRef.current = "camera";
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
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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

  // Retain the real session across tabs, but release it on shell unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseHandles();
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      if (remoteTypingTimerRef.current) clearTimeout(remoteTypingTimerRef.current);
    };
    // The ref-backed resource owner is mounted once by AppShell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tryJoin = () => {
      if (pathname !== "/pc" && pathname !== "/bridge") return;
      const pairing = decodeBridgePairing(window.location.href);
      if (!pairing) return;
      window.history.replaceState(null, "", BRIDGE_PATH);
      void connectWith(pairing);
    };
    queueMicrotask(tryJoin);
    window.addEventListener("hashchange", tryJoin);
    if (pathname !== "/pc" && pathname !== "/bridge") {
      // Navigating away never leaves a hidden camera running.
      queueMicrotask(() => {
        if (!mountedRef.current) return;
        stopCamera();
        if (phase === "scanning") setPhase("home");
      });
    }
    return () => window.removeEventListener("hashchange", tryJoin);
    // Only navigation/hash changes should consume a pairing URL, not chat renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (phase !== "connected" || view !== "chat") return;
    if (pathname !== "/pc" && pathname !== "/bridge") return;
    timelineRef.current?.lastElementChild?.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "instant" : "smooth" });
  }, [items.length, remoteTyping, phase, view, pathname]);

  // ---------- Presentation: every state below is derived from the real session ----------
  const chatVisible = ready && view === "chat";
  const hasItems = items.length > 0;
  const validPaste = decodeBridgePairing(pasteValue) !== null;
  const retry = () => {
    if (lastActionRef.current === "camera") openScanner();
    else if (lastActionRef.current === "join" && lastPairingRef.current) void connectWith(lastPairingRef.current);
    else void startHosting();
  };
  const failure = joinError || scanError || (hostState === "error" || hostState === "locked" ? hostDetail || tx("تعذّر الاتصال.", "Could not connect.") : "");
  const timeline = <ol ref={timelineRef} className="msgs bridge-timeline" aria-label={tx("سجل الجلسة", "Session log")} aria-live="polite" aria-relevant="additions">
    {items.map(item => item.kind === "chat" ? (
      <li key={`chat-${item.direction}-${item.id}`} className={`m bridge-bubble ${item.direction} ${item.direction === "out" ? "me" : "pc"}`}>
        <p dir="auto">{item.text}</p>
        <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" })}</time>
      </li>
    ) : (
      <li key={`file-${item.direction}-${item.id}`} className={`m file bridge-file ${item.direction} ${item.direction === "out" ? "me" : "pc"}`}>
        <span className="fi"><DesignIcon name="doc" /></span>
        <div className="bridge-file-main">
          <b dir="auto">{item.name}</b>
          <small>{formatBytes(item.size)} · {fileStatusText(item, tx)}</small>
          {(item.status === "sending" || item.status === "receiving") && <progress aria-label={tx(`تقدم ${item.name}`, `${item.name} progress`)} max={item.size || 1} value={Math.min(item.progress, item.size || 1)} />}
          {item.status === "done" && item.bytes && <BridgeMediaPreview item={item} alt={item.name} />}
          {item.error && <small className="bridge-file-error" role="alert">{item.error}</small>}
          <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
        {item.status === "done" && item.bytes && <button type="button" className="file-download" onClick={() => downloadItem(item)} aria-label={tx(`تنزيل ${item.name}`, `Download ${item.name}`)}><DesignIcon name="up" style={{transform:"rotate(180deg)"}} /></button>}
      </li>
    ))}
    {ready && remoteTyping && <li className="m pc typing" role="status" aria-label={tx("يكتب الآن…", "typing…")}><s/><s/><s/></li>}
  </ol>;

  return <main className="transfer-page bridge-page" data-page={pathname === "/pc" ? "pc" : "bridge"} data-phase={phase} data-chat={chatVisible}>
    {!chatVisible && <>
      <section className="workspace-intro">
        <h1>{tx("اربط هاتفك بالكمبيوتر", "Link your phone and computer")}</h1>
        <p>{tx("امسح رمز أحد الجهازين من الآخر. لا تمر البيانات بأي خادم.", "Scan one device’s code from the other. Files are transferred peer to peer.")}</p>
      </section>
      <div className="grid bridge-grid">
        {phase === "home" && <>
          <Card className="act2"><div className="ico"><DesignIcon name="monitor" /></div>
            <h2>{tx("اعرض رمز الربط من هنا", "Show the pairing code here")}</h2>
            <p>{tx("استخدم هذا على الكمبيوتر، ثم امسح الرمز بالهاتف.", "Use this on the computer, then scan the code with your phone.")}</p>
            <Capsule tinted large onClick={() => void startHosting()}><DesignIcon name="qr" />{tx("أنشئ رمز الربط", "Create pairing code")}</Capsule>
          </Card>
          <Card className="act2"><div className="ico"><DesignIcon name="scan" /></div>
            <h2>{tx("امسح رمز الكمبيوتر", "Scan the computer’s code")}</h2>
            <p>{tx("استخدم هذا على الهاتف لمسح الرمز المعروض على الشاشة.", "Use this on the phone to scan the code shown on the screen.")}</p>
            <Capsule large onClick={openScanner}><DesignIcon name="cam" />{tx("افتح الكاميرا للمسح", "Open camera to scan")}</Capsule>
          </Card>
          <Card className="act2">
            <form onSubmit={onPasteSubmit}>
              <h2 className="s"><label htmlFor="bridge-paste-input">{tx("أو الصق الرابط الذي يعرضه الكمبيوتر", "Or paste the link shown on the computer")}</label></h2>
              <input id="bridge-paste-input" className="field" type="text" dir="ltr" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…/pc#QFB1…" value={pasteValue} aria-invalid={!!pasteValue.trim() && !validPaste} aria-describedby={pasteValue.trim() && !validPaste ? "pair-invalid" : undefined} onChange={e => setPasteValue(e.target.value)} />
              {pasteValue.trim() && !validPaste && <p id="pair-invalid" className="bridge-error">{tx("الرابط أو الرمز غير صالح. انسخ الرابط كاملاً من الكمبيوتر.", "Invalid link. Copy the full link from the computer.")}</p>}
              <Capsule type="submit" tinted large disabled={!validPaste}>{tx("اتصل", "Connect")}</Capsule>
            </form>
          </Card>
        </>}
        {phase === "hosting" && <Card className="act2 pair-stage">
          <h2>{tx("رمز الربط", "Pairing code")}</h2>
          <p>{tx("امسحه بالهاتف من تبويب «ربط».", "Scan it from the Pair tab on your phone.")}</p>
          {qrImage && hostState !== "error" && <div className="qrt"><canvas ref={qrCanvasRef} className="bridge-qr-canvas" role="img" aria-label={tx("رمز ربط QRFerry", "QRFerry pairing code")} /></div>}
          <div className="status" role="status"><span className={`dot ${hostState === "waiting" || hostState === "starting" ? "live" : "error"}`} />{hostState === "starting" ? tx("جارٍ تجهيز الرمز…", "Preparing the code…") : hostState === "waiting" ? tx("بانتظار المسح…", "Waiting for a scan…") : hostDetail}</div>
          {notice && <p role="status">{notice}</p>}
          {shareUrl && hostState !== "error" && <div className="bridge-link-row"><code dir="ltr">{shareUrl}</code><Capsule onClick={() => void copyShareUrl()}><DesignIcon name={copied ? "ok" : "copy"} />{copied ? tx("تم النسخ", "Copied") : tx("انسخ الرابط", "Copy link")}</Capsule></div>}
          <Capsule large onClick={disconnect}>{tx("إلغاء", "Cancel")}</Capsule>
        </Card>}
        {phase === "scanning" && <Card className="act2 pair-stage">
          <h2>{tx("الكاميرا", "Camera")}</h2><p>{tx("وجّهها إلى الرمز المعروض على الكمبيوتر.", "Point it at the code on your computer.")}</p>
          <div className="cam bridge-camera"><video ref={videoRef} muted playsInline aria-label={tx("معاينة الكاميرا", "Camera preview")} /><CameraCorners />{cameraRunning && <i className="ln" aria-hidden="true" />}<canvas ref={scanCanvasRef} width={SCAN_SIZE} height={SCAN_SIZE} hidden /></div>
          {scanError && <p className="bridge-error" role="alert">{scanError}</p>}
          <Capsule large onClick={cancelScanner}>{tx("إلغاء", "Cancel")}</Capsule>
        </Card>}
        {phase === "connecting" && <Card className="act2 pair-stage"><h2>{tx("جارٍ الاتصال والتحقق…", "Connecting and verifying…")}</h2><div className="status" role="status"><span className="dot live"/>{tx("لن يتم قبول أي بيانات قبل اكتمال التحقق.", "No data is accepted until verification completes.")}</div><Capsule large onClick={disconnect}>{tx("إلغاء", "Cancel")}</Capsule></Card>}
        {ready && <Card className="act2"><h2>{tx("متصل", "Connected")}</h2><div className="status"><span className="dot connected" />{tx("جلسة الاتصال", "Session")}</div><Capsule tinted large onClick={() => setView("chat")}><DesignIcon name="chat" />{tx("محادثة", "Chat")}</Capsule><Capsule large onClick={disconnect}>{tx("قطع الاتصال", "Disconnect")}</Capsule></Card>}
        {failure && <Card className="act2 pair-stage"><p className="bridge-error" role="alert"><span className="dot error" />{failure}</p><Capsule large onClick={retry}>{tx("إعادة المحاولة", "Try again")}</Capsule></Card>}
      </div>
      {!ready && <p className="steps">{tx("اعرض الرمز على جهاز · امسحه من الآخر · ابدأ المحادثة", "Show the code on one device · scan it from the other · start chatting")}</p>}
      {phase === "home" && hasItems && <section className="card bridge-history"><div className="bridge-section-head"><h2>{tx("آخر الرسائل والملفات", "Latest messages and files")}</h2><Capsule onClick={() => setItems([])}>{tx("مسح السجل", "Clear log")}</Capsule></div>{timeline}</section>}
    </>}
    {chatVisible && <section className="bridge-session" aria-label={tx("جلسة الاتصال", "Session")}>
      <Glass className="chatbar"><span className="av"><DesignIcon name="monitor" /></span><div><b>{role === "host" ? tx("الهاتف", "Phone") : tx("الكمبيوتر", "Computer")}</b><small className="bridge-status" role="status">{tx("متصل الآن", "Connected now")}</small></div><button className="x" type="button" onClick={disconnect} aria-label={tx("قطع الاتصال", "Disconnect")}><DesignIcon name="x" /></button></Glass>
      {notice && <p className="bridge-error" role="alert">{notice}</p>}
      <div className={`bridge-drop ${dragging ? "dragging" : ""}`} onDragOver={e => {e.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <div className="sys"><DesignIcon name="ok" />{tx("تم الاتصال", "Connected")}</div>
        {timeline}
      </div>
      {/* Outside the animated page: fixed controls must stay anchored to the viewport. */}
      {(["/pc", "/bridge"].includes(pathname)) && createPortal(<form className="bridge-composer" onSubmit={e => {e.preventDefault();sendChat();}}>
        <input ref={fileInputRef} type="file" multiple accept="image/*,audio/*,video/*,*/*" hidden onChange={onPickFiles} tabIndex={-1} />
        <CircleButton onClick={() => fileInputRef.current?.click()} aria-label={tx("إرفاق", "Attach file")}><DesignIcon name="plus" /></CircleButton>
        <Glass className="inp"><textarea rows={1} value={draft} maxLength={BRIDGE_MAX_CHAT_CHARS} onChange={e => onDraftChange(e.target.value)} onKeyDown={onComposerKey} placeholder={tx("رسالة", "Message")} aria-label={tx("اكتب رسالة", "Type a message")} /></Glass>
        <CircleButton type="submit" tinted disabled={!draft.trim()} aria-label={tx("إرسال", "Send")}><DesignIcon name="sendup" /></CircleButton>
      </form>, document.body)}
    </section>}
  </main>;
}
