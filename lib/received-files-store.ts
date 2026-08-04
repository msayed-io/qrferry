/**
 * مخزن الملفات المستلمة على جهاز الاستقبال (IndexedDB).
 *
 * يخزّن الملفات المستلمة محلياً فور اكتمال النقل — بحيث:
 *  - لا يضيع الملف إذا أُعيد تحميل الصفحة أو أُغلقت (Blob مؤقت يتبخر).
 *  - يمكن تشغيل/حفظ أي ملف مستلم سابقاً من قائمة.
 *  - يُعرض الملف عبر Blob URL عند الطلب فقط (لا يُحمَّل في React state).
 */

const DB_NAME = "qrferry-received-files";
const DB_VERSION = 1;
const STORE_NAME = "files";

export type ReceivedStoredFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** البايتات الفعلية (ArrayBuffer). */
  data: ArrayBuffer;
  receivedAt: number;
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
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("receivedAt", "receivedAt");
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

export function makeFileId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** يخزّن ملفاً مستلماً محلياً. يعيد معرفه. */
export async function storeReceivedFile(file: {
  name: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<string> {
  const id = makeFileId();
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const entry: ReceivedStoredFile = {
    id,
    name: file.name,
    mime: file.mime,
    size: file.bytes.length,
    data: file.bytes.slice().buffer,
    receivedAt: Date.now(),
  };
  await requestToPromise(tx.objectStore(STORE_NAME).put(entry));
  return id;
}

/** يعيد قائمة الملفات المستلمة (الأحدث أولاً) — دون تحميل البايتات. */
export async function listReceivedFiles(
  limit = 50,
): Promise<Array<Omit<ReceivedStoredFile, "data">>> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const all = await requestToPromise(
      tx.objectStore(STORE_NAME).index("receivedAt").getAll() as IDBRequest<
        ReceivedStoredFile[]
      >,
    );
    return [...all]
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, limit)
      .map(({ id, name, mime, size, receivedAt }) => ({ id, name, mime, size, receivedAt }));
  } catch {
    return [];
  }
}

/** يجلب بايتات ملف مخزَّن (عند الطلب فقط — التشغيل/الحفظ). */
export async function loadReceivedFileBytes(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const row = await requestToPromise(
      tx.objectStore(STORE_NAME).get(id) as IDBRequest<ReceivedStoredFile | undefined>,
    );
    return row?.data ?? null;
  } catch {
    return null;
  }
}

/** يمسح ملفاً مخزّناً. */
export async function deleteReceivedFile(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await requestToPromise(tx.objectStore(STORE_NAME).delete(id));
  } catch {
    // تجاهل
  }
}

/** يمسح كل الملفات المخزنة. */
export async function clearReceivedFiles(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await requestToPromise(tx.objectStore(STORE_NAME).clear());
  } catch {
    // تجاهل
  }
}
