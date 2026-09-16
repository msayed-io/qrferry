/** Browser-local library. Metadata and payload access are separate; a successful
 * write resolves only after transaction commit. Browser eviction is still possible. */
const DB_NAME = "qrferry-received-files";
const DB_VERSION = 2;
const FILES = "files";
const META = "metadata";
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
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    r.onblocked = () => {
      blocked = true;
      reject(
        new Error(
          "أغلق تبويبات QRFerry القديمة ثم أعد المحاولة لتحديث المكتبة.",
        ),
      );
    };
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(FILES)) {
        const s = db.createObjectStore(FILES, { keyPath: "id" });
        s.createIndex("receivedAt", "receivedAt");
      }
      if (!db.objectStoreNames.contains(META)) {
        const m = db.createObjectStore(META, { keyPath: "id" });
        m.createIndex("receivedAt", "receivedAt");
        // One-time v1 migration, cursor-at-a-time, never load the entire old library.
        const cursor = r.transaction!.objectStore(FILES).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            m.put(metadata(c.value));
            c.continue();
          }
        };
      }
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      if (blocked) {
        r.result.close();
        return;
      }
      r.result.onversionchange = () => {
        r.result.close();
        dbPromise = undefined;
      };
      resolve(r.result);
    };
  });
  dbPromise.catch(() => {
    dbPromise = undefined;
  });
  return dbPromise;
}
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("لم تكتمل معاملة تخزين الملف."));
    tx.onerror = () => {
      /* an unhandled request error aborts the transaction */
    };
  });
}
function requested<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export function makeFileId(): string {
  return `file-${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`;
}
export async function storeReceivedFile(file: {
  name: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<string> {
  const db = await openDb();
  const entry: ReceivedStoredFile = {
    id: makeFileId(),
    name: file.name,
    mime: file.mime,
    size: file.bytes.byteLength,
    data: file.bytes.slice().buffer,
    receivedAt: Date.now(),
  };
  const tx = db.transaction([FILES, META], "readwrite");
  const done = committed(tx);
  tx.objectStore(FILES).put(entry);
  tx.objectStore(META).put(metadata(entry));
  await done;
  return entry.id;
}
export async function listReceivedFiles(
  limit = 50,
): Promise<ReceivedFileMetadata[]> {
  const db = await openDb();
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return new Promise((resolve, reject) => {
    const rows: ReceivedFileMetadata[] = [];
    const tx = db.transaction(META, "readonly");
    const r = tx.objectStore(META).index("receivedAt").openCursor(null, "prev");
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const c = r.result;
      if (!c || rows.length >= Math.floor(limit)) {
        resolve(rows);
        return;
      }
      rows.push(c.value);
      c.continue();
    };
  });
}
export async function loadReceivedFileBytes(
  id: string,
): Promise<ArrayBuffer | null> {
  const db = await openDb();
  const row = await requested(
    db.transaction(FILES, "readonly").objectStore(FILES).get(id) as IDBRequest<
      ReceivedStoredFile | undefined
    >,
  );
  return row?.data ?? null;
}
export async function deleteReceivedFile(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FILES, META], "readwrite");
  const done = committed(tx);
  tx.objectStore(FILES).delete(id);
  tx.objectStore(META).delete(id);
  await done;
}
export async function clearReceivedFiles(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FILES, META], "readwrite");
  const done = committed(tx);
  tx.objectStore(FILES).clear();
  tx.objectStore(META).clear();
  await done;
}
