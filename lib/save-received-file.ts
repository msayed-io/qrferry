import { receivedBlob } from "./received-media";
export type SaveResult = "saved" | "requested" | "cancelled" | "unsupported";
type SavePicker = (options: { suggestedName: string }) => Promise<{
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort?: () => Promise<void>;
  }>;
}>;

/** A download click is a request, never a confirmed disk save. Abort means cancel. */
export async function saveReceivedFile(
  file: { name: string; mime: string; url: string },
  bytes: Uint8Array,
): Promise<SaveResult> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, { suggestedName: file.name });
      const writable = await handle.createWritable();
      try {
        await writable.write(receivedBlob(bytes, file.mime));
        await writable.close();
      } catch (e) {
        try {
          await writable.abort?.();
        } catch {
          /* preserve write error */
        }
        throw e;
      }
      return "saved";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError")
        return "cancelled";
      throw e;
    }
  }
  return requestReceivedDownload(file);
}

/** Direct browser download: never invokes the filesystem picker. */
export function requestReceivedDownload(file: {
  name: string;
  url: string;
}): "requested" | "unsupported" {
  const a = document.createElement("a");
  if (!("download" in a)) return "unsupported";
  a.href = file.url;
  a.download = file.name;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
  return "requested";
}

/** Dedicated download URLs survive player selection changes, then release their memory. */
export class ReceivedDownloads {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  request(file: {
    name: string;
    mime: string;
    bytes: Uint8Array;
  }): "requested" | "unsupported" {
    const url = URL.createObjectURL(receivedBlob(file.bytes, file.mime));
    try {
      const result = requestReceivedDownload({ name: file.name, url });
      if (result === "unsupported") {
        URL.revokeObjectURL(url);
      } else {
        this.pending.set(
          url,
          setTimeout(() => {
            URL.revokeObjectURL(url);
            this.pending.delete(url);
          }, 60_000),
        );
      }
      return result;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  dispose(): void {
    for (const [url, timer] of this.pending) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.pending.clear();
  }
}
