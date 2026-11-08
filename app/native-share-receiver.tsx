import { useEffect, useState } from "react";
import { NativeDevice, isNativeDevice } from "@/lib/native-device";
import {
  stashSharedFiles,
  type SharedFileEntry,
} from "@/lib/shared-files-store";
import { navigate } from "./router";
import { useI18n } from "./lang-provider";

export function NativeShareReceiver() {
  const { lang } = useI18n();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isNativeDevice()) return;
    let cancelled = false,
      busy = false,
      again = false;
    const receive = async () => {
      if (cancelled) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const { files } = await NativeDevice.getSharedFiles();
        if (cancelled || !files.length) return;
        if (
          files.length > 3 ||
          files.reduce((sum, f) => sum + Math.max(0, f.size), 0) >
            512 * 1024 * 1024
        )
          throw new Error("limits");
        const entries: SharedFileEntry[] = [];
        let total = 0;
        for (const file of files) {
          const chunks: Uint8Array[] = [];
          let offset = 0;
          while (true) {
            const { data } = await NativeDevice.readSharedChunk({
              id: file.id,
              offset,
              length: 196608,
            });
            if (cancelled) return;
            const binary = atob(data);
            if (!binary.length) break;
            const chunk = Uint8Array.from(binary, (c) => c.charCodeAt(0));
            offset += chunk.length;
            total += chunk.length;
            if (total > 512 * 1024 * 1024) throw new Error("limits");
            chunks.push(chunk);
          }
          if (file.size >= 0 && offset !== file.size)
            throw new Error("incomplete");
          const bytes = new Uint8Array(offset);
          let at = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, at);
            at += chunk.length;
          }
          entries.push({
            name: file.name,
            mime: file.mime,
            data: bytes.buffer,
          });
        }
        await stashSharedFiles(entries);
        await NativeDevice.clearSharedFiles({
          ids: files.map((file) => file.id),
        });
        if (cancelled) return;
        setError("");
        navigate("/");
        window.dispatchEvent(new Event("qrferry-shared-files"));
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "storage");
      } finally {
        busy = false;
        if (again) {
          again = false;
          void receive();
        }
      }
    };
    const listener = NativeDevice.addListener(
      "sharedFiles",
      () => void receive(),
    );
    void receive();
    return () => {
      cancelled = true;
      void listener.then((handle) => handle.remove());
    };
  }, []);
  if (!error) return null;
  return (
    <p role="alert" className="error-note">
      {lang === "ar"
        ? "تعذّر استيراد المشاركة. اختر حتى 3 ملفات بإجمالي 512 ميجابايت، وتأكد من سماح التطبيق المرسل بقراءتها."
        : "Could not import the share. Choose up to 3 files totaling 512 MiB and allow QRFerry to read them."}
    </p>
  );
}
