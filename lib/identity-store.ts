/**
 * مخزن الهوية الرقمية (IndexedDB):
 *  - مفتاح التوقيع الخاص + المفتاح العام للمستخدم (مخزنان محلياً فقط)
 *  - قائمة المفاتيح العامة الموثوقة (هويات المرسلين المقبولين)
 */

const DB_NAME = "qrferry-identity";
const DB_VERSION = 1;
const STORE_IDENTITY = "identity";
const STORE_TRUSTED = "trusted";

export type StoredIdentity = {
  label: string;
  publicKeyRaw: Uint8Array;
  privateKeyPkcs8: Uint8Array;
  createdAt: number;
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
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
        db.createObjectStore(STORE_IDENTITY, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_TRUSTED)) {
        db.createObjectStore(STORE_TRUSTED, { keyPath: "key" });
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

export async function getStoredIdentity(): Promise<StoredIdentity | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_IDENTITY, "readonly");
    const row = await requestToPromise(
      tx.objectStore(STORE_IDENTITY).get("self") as IDBRequest<
        (StoredIdentity & { key: string }) | undefined
      >,
    );
    if (!row) return null;
    const identity: StoredIdentity = {
      label: row.label,
      publicKeyRaw: row.publicKeyRaw,
      privateKeyPkcs8: row.privateKeyPkcs8,
      createdAt: row.createdAt,
    };
    return identity;
  } catch {
    return null;
  }
}

export async function saveStoredIdentity(
  identity: StoredIdentity,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_IDENTITY, "readwrite");
  await requestToPromise(
    tx.objectStore(STORE_IDENTITY).put({ key: "self", ...identity }),
  );
}

export async function getTrustedKeys(): Promise<Uint8Array[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_TRUSTED, "readonly");
    const row = await requestToPromise(
      tx.objectStore(STORE_TRUSTED).get("trusted") as IDBRequest<
        { key: string; keys: Uint8Array[] } | undefined
      >,
    );
    return row?.keys ?? [];
  } catch {
    return [];
  }
}

export async function addTrustedKey(
  publicKeyRaw: Uint8Array,
): Promise<Uint8Array[]> {
  const keys = await getTrustedKeys();
  const fingerprint = Array.from(publicKeyRaw).join(",");
  if (!keys.some((existing) => Array.from(existing).join(",") === fingerprint)) {
    keys.push(publicKeyRaw);
  }
  const db = await openDb();
  const tx = db.transaction(STORE_TRUSTED, "readwrite");
  await requestToPromise(
    tx.objectStore(STORE_TRUSTED).put({ key: "trusted", keys }),
  );
  return keys;
}

export async function removeTrustedKey(
  publicKeyRaw: Uint8Array,
): Promise<Uint8Array[]> {
  const keys = await getTrustedKeys();
  const fingerprint = Array.from(publicKeyRaw).join(",");
  const filtered = keys.filter(
    (existing) => Array.from(existing).join(",") !== fingerprint,
  );
  const db = await openDb();
  const tx = db.transaction(STORE_TRUSTED, "readwrite");
  await requestToPromise(
    tx.objectStore(STORE_TRUSTED).put({ key: "trusted", keys: filtered }),
  );
  return filtered;
}
