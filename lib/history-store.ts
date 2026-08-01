/**
 * سجل النقل المحلي (IndexedDB): يحفظ آخر النقولات المستقبلة
 * (الاسم، الحجم، الوقت، الحالة) على جهاز المستخدم فقط.
 */

const DB_NAME = "qrferry-history";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const MAX_ENTRIES = 100;

export type HistoryEntry = {
  id?: number;
  name: string;
  size: number;
  fileCount: number;
  time: number;
  encrypted: boolean;
  signed: boolean;
  verified: boolean;
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
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("time", "time");
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

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    await requestToPromise(store.add(entry));
    // إبقاء العدد ضمن الحد
    const count = await requestToPromise(store.count() as IDBRequest<number>);
    if (count > MAX_ENTRIES) {
      const all = await requestToPromise(
        store.index("time").getAll() as IDBRequest<HistoryEntry[]>,
      );
      const sorted = [...all].sort((a, b) => a.time - b.time);
      const toRemove = count - MAX_ENTRIES;
      for (const stale of sorted.slice(0, toRemove)) {
        await requestToPromise(store.delete(stale.id as number));
      }
    }
  } catch {
    // السجل اختياري؛ لا نوقف النقل عند فشله.
  }
}

export async function getHistoryEntries(
  limit = 50,
): Promise<HistoryEntry[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const all = await requestToPromise(
      tx.objectStore(STORE_NAME).index("time").getAll() as IDBRequest<
        HistoryEntry[]
      >,
    );
    return [...all]
      .sort((a, b) => b.time - a.time)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await requestToPromise(tx.objectStore(STORE_NAME).clear());
  } catch {
    // تجاهل.
  }
}
