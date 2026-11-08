import { useEffect, useRef, useState } from "react";
import { FastReceiver } from "@/lib/fast-transfer";
import { renderRawQrViaWorker } from "@/lib/qr-render-worker";
import {
  receivedBlob,
  unpackReceivedDelivery,
  type ReceivedMediaFile,
} from "@/lib/received-media";
import {
  listReceivedFiles,
  storeReceivedFile,
  loadReceivedFileBytes,
  deleteReceivedFile,
  type ReceivedFileMetadata,
} from "@/lib/received-files-store";
import { getTrustedKeys } from "@/lib/identity-store";
import { isNativeDevice, saveNativeFile } from "@/lib/native-device";
import { formatBytes } from "@/lib/optical-transfer";
import { useI18n } from "../lang-provider";
import { Capsule, Card, NetworkStatus } from "../design-system";

/** Restores the previously empty /tv route using the existing QFTV protocol,
 * validation and v2 library schema, not a second transport implementation. */
export function TvClient() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [retry, setRetry] = useState(0),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [progress, setProgress] = useState<{
    received: number;
    total: number;
  } | null>(null);
  const [image, setImage] = useState<ImageData | null>(null),
    [files, setFiles] = useState<ReceivedMediaFile[]>([]);
  const [library, setLibrary] = useState<ReceivedFileMetadata[]>([]);
  const [preview, setPreview] = useState<{
    url: string;
    mime: string;
    name: string;
  } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const refresh = () =>
    listReceivedFiles()
      .then(setLibrary)
      .catch((cause) => setError(String(cause)));
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    let disposed = false;
    let receiver: FastReceiver | undefined;
    const controller = new AbortController();
    setError("");
    setImage(null);
    setProgress(null);
    void FastReceiver.create(
      (file) => {
        void (async () => {
          const delivery = await unpackReceivedDelivery(
            file,
            await getTrustedKeys(),
          );
          if (disposed) return;
          setFiles(delivery.files);
          if (window.__qrferryTestMode)
            window.__qrferryTvReceived = {
              name: file.name,
              mime: file.mime,
              size: file.size,
              bytes: Array.from(file.bytes),
            };
          for (const delivered of delivery.files)
            await storeReceivedFile(delivered);
          if (!disposed) await refresh();
        })().catch((cause) => {
          if (!disposed)
            setError(cause instanceof Error ? cause.message : String(cause));
        });
      },
      (received, total) => {
        if (!disposed) setProgress({ received, total });
      },
      (message) => {
        if (!disposed) setStatus(message);
      },
      (message) => {
        if (!disposed) setError(message);
      },
      controller.signal,
    )
      .then(async (handle) => {
        if (disposed) {
          handle.destroy();
          return;
        }
        receiver = handle;
        const picture = await renderRawQrViaWorker({
          packet: new TextEncoder().encode(handle.payload),
          version: 8,
          ecc: "M",
          scale: 7,
        });
        if (disposed) return;
        setImage(picture);
        if (window.__qrferryTestMode) {
          window.__qrferryTvInfo = {
            peerId: handle.peerId,
            passcode: handle.passcode,
            payload: handle.payload,
          };
          const n = picture.width / 7,
            data: number[] = [];
          for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++)
              data.push(
                picture.data[(y * 7 * picture.width + x * 7) * 4] < 128 ? 1 : 0,
              );
          window.__qrferryTvModules = { n, data };
        }
      })
      .catch((cause) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
      controller.abort();
      receiver?.destroy();
    };
  }, [retry]);
  useEffect(() => {
    if (image && canvas.current) {
      canvas.current.width = image.width;
      canvas.current.height = image.height;
      canvas.current.getContext("2d")?.putImageData(image, 0, 0);
    }
  }, [image]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const download = async (file: ReceivedMediaFile) => {
    try {
      if (isNativeDevice()) {
        await saveNativeFile(file.name, file.mime, file.bytes);
        return;
      }
      const url = URL.createObjectURL(receivedBlob(file.bytes, file.mime));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const openStored = async (row: ReceivedFileMetadata) => {
    try {
      const bytes = await loadReceivedFileBytes(row.id);
      if (!bytes) throw new Error(ar ? "الملف غير موجود" : "File not found");
      setFiles([
        { name: row.name, mime: row.mime, bytes: new Uint8Array(bytes) },
      ]);
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <main className="transfer-page">
      <div className="workspace-intro">
        <h1>{ar ? "استقبال على الشاشة" : "Screen receiver"}</h1>
        <p>
          {ar
            ? "افتح النقل السريع على الجهاز المرسل وامسح هذا الرمز."
            : "Open Quick transfer on the sending device and scan this code."}
        </p>
      </div>
      <div className="sender-grid">
        <Card>
          <h2>{ar ? "رمز الاستقبال" : "Receiver code"}</h2>
          <NetworkStatus />
          <canvas
            ref={canvas}
            aria-label={ar ? "رمز QR للاستقبال" : "Receiver QR code"}
            style={{
              display: image ? "block" : "none",
              width: "100%",
              maxWidth: 400,
              height: "auto",
              background: "#fff",
              imageRendering: "pixelated",
              margin: "16px auto",
            }}
          />
          {!image && !error && (
            <p role="status">
              {ar
                ? "جارٍ الاتصال بخادم الإشارة…"
                : "Connecting to the signaling server…"}
            </p>
          )}
          {progress && (
            <>
              <progress
                max={Math.max(1, progress.total)}
                value={progress.received}
              />
              <p>
                {formatBytes(progress.received)} / {formatBytes(progress.total)}
              </p>
            </>
          )}
          {ar && status && <p role="status">{status}</p>}
          {!ar && progress && (
            <p role="status">
              {progress.received === progress.total
                ? "Bytes received; validating and saving."
                : "Receiving file…"}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Capsule onClick={() => setRetry((value) => value + 1)}>
            {ar ? "تجديد الاتصال والرمز" : "Renew connection and code"}
          </Capsule>
        </Card>
        <Card>
          <h2>{ar ? "الملفات المستلمة" : "Received files"}</h2>
          {files.map((file, index) => (
            <div className="file-row" key={index}>
              <span className="fname">{file.name}</span>
              <span>{formatBytes(file.bytes.length)}</span>
              <button onClick={() => void download(file)}>
                {ar ? "تنزيل" : "Download"}
              </button>
              {/^(audio|video|image)\//.test(file.mime) && (
                <button
                  onClick={() =>
                    setPreview({
                      name: file.name,
                      mime: file.mime,
                      url: URL.createObjectURL(
                        receivedBlob(file.bytes, file.mime),
                      ),
                    })
                  }
                >
                  {ar ? "فتح" : "Open"}
                </button>
              )}
            </div>
          ))}
          {preview && (
            <div>
              <p>{preview.name}</p>
              {preview.mime.startsWith("audio/") ? (
                <audio src={preview.url} controls />
              ) : preview.mime.startsWith("video/") ? (
                <video
                  src={preview.url}
                  controls
                  style={{ maxWidth: "100%" }}
                />
              ) : (
                <img
                  src={preview.url}
                  alt={preview.name}
                  style={{ maxWidth: "100%" }}
                />
              )}
              <button onClick={() => setPreview(null)}>
                {ar ? "إغلاق" : "Close"}
              </button>
            </div>
          )}
          <h3>{ar ? "المكتبة المحلية" : "Local library"}</h3>
          {library.map((row) => (
            <div className="file-row" key={row.id}>
              <button onClick={() => void openStored(row)}>{row.name}</button>
              <span>{formatBytes(row.size)}</span>
              <button
                onClick={() =>
                  void deleteReceivedFile(row.id)
                    .then(refresh)
                    .catch((cause) => setError(String(cause)))
                }
              >
                {ar ? "حذف" : "Delete"}
              </button>
            </div>
          ))}
        </Card>
      </div>
    </main>
  );
}
