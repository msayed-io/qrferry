/**
 * مخزن الملفات المتبادلة عبر «المشاركة» (Web Share Target):
 * صفحة /share (route) تعيد صفحة مؤقتة تحفظ الملفات هنا في IndexedDB
 * ثم يعيد التوجيه إلى صفحة الإرسال التي تلتقطها وتجهّزها تلقائياً.
 */

const DB_NAME = "qrferry-shared";
const DB_VERSION = 1;
const STORE_NAME = "pending";

export type SharedFileEntry = {
  name: string;
  mime: string;
  data: ArrayBuffer;
};

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB غير متاح في هذا السياق."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function stashSharedFiles(
  files: SharedFileEntry[],
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  await requestToPromise(
    tx.objectStore(STORE_NAME).put({ key: "pending", files, at: Date.now() }),
  );
}

export async function takeSharedFiles(): Promise<SharedFileEntry[] | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const row = await requestToPromise(
      store.get("pending") as IDBRequest<
        { key: string; files: SharedFileEntry[] } | undefined
      >,
    );
    if (row) {
      await requestToPromise(store.delete("pending"));
    }
    return row?.files ?? null;
  } catch {
    return null;
  }
}
