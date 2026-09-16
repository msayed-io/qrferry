import { receivedBlob } from "./received-media";
export type SaveResult = "saved" | "requested" | "cancelled" | "unsupported";
type SavePicker = (options: {
  suggestedName: string;
}) => Promise<{
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
  const a = document.createElement("a");
  if (!("download" in a)) return "unsupported";
  a.href = file.url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return "requested";
}
