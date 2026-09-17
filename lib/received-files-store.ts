import {
  BrowserOperationTimeout,
  describeBrowserError,
  withDeadline,
} from "./browser-operation";

/** Same v2 schema: no deletion or destructive migration. Metadata stays separate from payloads. */
const DB_NAME = "qrferry-received-files";
const DB_VERSION = 2;
const FILES = "files";
const META = "metadata";
export const STORAGE_OPEN_TIMEOUT_MS = 15_000;
export const STORAGE_WRITE_TIMEOUT_MS = 30_000;
export const STORAGE_READ_TIMEOUT_MS = 15_000;
export type StorageStage = {
  phase: "open" | "write";
  state: "start" | "request-success" | "complete" | "error" | "timeout";
  elapsedMs: number;
  error?: string;
};
export type ReceivedStoredFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: ArrayBuffer;
  receivedAt: number;
};
export type ReceivedFileMetadata = Omit<ReceivedStoredFile, "data">;
let dbPromise: Promise<IDBDatabase> | undefined;
function metadata({
  id,
  name,
  mime,
  size,
  receivedAt,
}: ReceivedStoredFile): ReceivedFileMetadata {
  return { id, name, mime, size, receivedAt };
}
function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("IndexedDB غير متاح."));
  if (dbPromise) return dbPromise;
  let abandoned = false;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onblocked = () => {
      abandoned = true;
      reject(
        new Error(
          "أغلق تبويبات QRFerry القديمة ثم أعد المحاولة. لا تمسح بيانات الموقع.",
        ),
      );
    };
    r.onupgradeneeded = () => {
      if (abandoned) {
        r.transaction?.abort();
        return;
      }
      const db = r.result;
      if (!db.objectStoreNames.contains(FILES)) {
        const store = db.createObjectStore(FILES, { keyPath: "id" });
        store.createIndex("receivedAt", "receivedAt");
      }
      if (!db.objectStoreNames.contains(META)) {
        const meta = db.createObjectStore(META, { keyPath: "id" });
        meta.createIndex("receivedAt", "receivedAt");
        const cursor = r.transaction!.objectStore(FILES).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            meta.put(metadata(c.value));
            c.continue();
          }
        };
      }
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      if (abandoned) {
        r.result.close();
        return;
      }
      r.result.onversionchange = () => {
        r.result.close();
        if (dbPromise === guarded) dbPromise = undefined;
      };
      resolve(r.result);
    };
  });
  const guarded = withDeadline(
    pending,
    "library-open",
    STORAGE_OPEN_TIMEOUT_MS,
    () => {
      abandoned = true;
    },
  );
  dbPromise = guarded;
  void guarded.catch(() => {
    if (dbPromise === guarded) dbPromise = undefined;
  });
  return guarded;
}
function committed(
  tx: IDBTransaction,
  phase: string,
  timeout = STORAGE_WRITE_TIMEOUT_MS,
): Promise<void> {
  const pending = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("لم تكتمل معاملة تخزين الملف."));
    tx.onerror = () => {
      /* The request's unhandled error aborts the transaction. */
    };
  });
  return withDeadline(pending, phase, timeout, () => tx.abort());
}
function requested<T>(r: IDBRequest<T>, tx: IDBTransaction): Promise<T> {
  const pending = new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    tx.onabort = () => reject(tx.error ?? new Error("Library read aborted"));
  });
  return withDeadline(pending, "library-read", STORAGE_READ_TIMEOUT_MS, () =>
    tx.abort(),
  );
}
export function makeFileId(): string {
  return `file-${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`;
}
export async function storeReceivedFile(
  file: { name: string; mime: string; bytes: Uint8Array },
  onStage?: (event: StorageStage) => void,
): Promise<string> {
  let phase: StorageStage["phase"] = "open";
  let started = Date.now();
  const emit = (state: StorageStage["state"], error?: string) =>
    onStage?.({ phase, state, elapsedMs: Date.now() - started, error });
  try {
    emit("start");
    const db = await openDb();
    emit("complete");
    phase = "write";
    started = Date.now();
    emit("start");
    const entry: ReceivedStoredFile = {
      id: makeFileId(),
      name: file.name,
      mime: file.mime,
      size: file.bytes.byteLength,
      data: file.bytes.slice().buffer,
      receivedAt: Date.now(),
    };
    const tx = db.transaction([FILES, META], "readwrite");
    const done = committed(tx, "library-write");
    // Observe immediately so synchronous put errors cannot leave an unhandled rejection.
    void done.catch(() => undefined);
    try {
      tx.objectStore(FILES).put(entry).onsuccess = () =>
        emit("request-success");
      tx.objectStore(META).put(metadata(entry));
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already inactive */
      }
      throw error;
    }
    await done;
    emit("complete");
    return entry.id;
  } catch (error) {
    emit(
      error instanceof BrowserOperationTimeout ? "timeout" : "error",
      describeBrowserError(error),
    );
    throw error;
  }
}
export async function listReceivedFiles(
  limit = 50,
): Promise<ReceivedFileMetadata[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const db = await openDb();
  const rows: ReceivedFileMetadata[] = [];
  const tx = db.transaction(META, "readonly");
  const done = committed(tx, "library-list", STORAGE_READ_TIMEOUT_MS);
  const r = tx.objectStore(META).index("receivedAt").openCursor(null, "prev");
  r.onsuccess = () => {
    const cursor = r.result;
    if (!cursor || rows.length >= Math.floor(limit)) return;
    rows.push(cursor.value);
    cursor.continue();
  };
  await done;
  return rows;
}
export async function loadReceivedFileBytes(
  id: string,
): Promise<ArrayBuffer | null> {
  const db = await openDb(),
    tx = db.transaction(FILES, "readonly");
  const row = await requested(
    tx.objectStore(FILES).get(id) as IDBRequest<ReceivedStoredFile | undefined>,
    tx,
  );
  return row?.data ?? null;
}
export async function deleteReceivedFile(id: string): Promise<void> {
  const db = await openDb(),
    tx = db.transaction([FILES, META], "readwrite");
  const done = committed(tx, "library-delete");
  tx.objectStore(FILES).delete(id);
  tx.objectStore(META).delete(id);
  await done;
}
export async function clearReceivedFiles(): Promise<void> {
  const db = await openDb(),
    tx = db.transaction([FILES, META], "readwrite");
  const done = committed(tx, "library-clear");
  tx.objectStore(FILES).clear();
  tx.objectStore(META).clear();
  await done;
}
