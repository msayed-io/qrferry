/**
 * تخزين مؤقت (IndexedDB) لرموز RaptorQ المستلمة، بحيث يمكن استئناف نقلٍ
 * انقطع في منتصفه — سواء بإغلاق المتصفح أو إيقاف الكاميرا — من حيث توقف.
 *
 * المفتاح مستمد من محتوى الملف نفسه (session = crc32 للحاوية) فإذا أُعيد
 * إرسال نفس الملف استُؤنف الاستقبال تلقائياً؛ أما الملفات الأخرى فلها
 * مفاتيح مختلفة ولا تختلط.
 */

export type StoredSession = {
  key: string;
  session: number;
  containerLength: number;
  symbolSize: number;
  originalSize: number;
  compressed: boolean;
  payloads: Uint8Array[];
  updatedAt: number;
};

const DB_NAME = "qrferry-resume";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

/** الحد الأقصى للرموز المحفوظة لكل جلسة (≈ 240 ميجابايت عند رمز ~2 كيلوبايت). */
export const MAX_SYMBOLS_STORED = 120_000;

export function sessionKey(
  session: number,
  containerLength: number,
  symbolSize: number,
): string {
  return `${session}:${containerLength}:${symbolSize}`;
}

export function payloadSymbolKey(session: number, payload: Uint8Array): string {
  if (payload.length < 4) return `${session}:`;
  return `${session}:${payload[0]}:${payload[1]}:${payload[2]}:${payload[3]}`;
}

let dbPromise: Promise<IDBDatabase> | undefined;

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB غير متاح في هذا السياق."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("updatedAt", "updatedAt");
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

export async function loadSession(
  key: string,
): Promise<StoredSession | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const stored = await requestToPromise(
      tx.objectStore(STORE_NAME).get(key) as IDBRequest<StoredSession | undefined>,
    );
    return stored ?? null;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  await requestToPromise(tx.objectStore(STORE_NAME).put(session));
}

export async function deleteSession(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await requestToPromise(tx.objectStore(STORE_NAME).delete(key));
  } catch {
    // تجاهل: الحذف غير الحرج.
  }
}

/** يبقي أحدث `keep` جلسات ويحذف الأقدم. */
export async function evictOldSessions(keep = 2): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("updatedAt");
    const all = await requestToPromise(index.getAll() as IDBRequest<StoredSession[]>);
    const sorted = [...all].sort((left, right) => right.updatedAt - left.updatedAt);
    for (const stale of sorted.slice(keep)) {
      await requestToPromise(store.delete(stale.key));
    }
  } catch {
    // تجاهل: الإخلاء غير الحرج.
  }
}

export async function countStoredSessions(): Promise<number> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    return await requestToPromise(
      tx.objectStore(STORE_NAME).count() as IDBRequest<number>,
    );
  } catch {
    return 0;
  }
}
