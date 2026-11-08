/**
 * مخزن الملفات المتبادلة عبر «المشاركة» (Web Share Target):
 * يستقبلها Service Worker أو جسر Android محليًا؛ لا تُرفع إلى خادم.
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

export async function readSharedFiles(): Promise<{files:SharedFileEntry[];at:number}|null> {
  const db=await openDb();const tx=db.transaction(STORE_NAME,'readonly');
  return (await requestToPromise(tx.objectStore(STORE_NAME).get('pending'))) ?? null;
}
/** Consume only after successful preparation; never delete a newer concurrent share. */
export async function acknowledgeSharedFiles(at:number):Promise<void> {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,'readwrite'),store=tx.objectStore(STORE_NAME);
    const request=store.get('pending');request.onsuccess=()=>{if(request.result?.at===at)store.delete('pending');};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
