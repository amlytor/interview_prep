// A minimal promise wrapper over IndexedDB, used as a key-value store.
//
// Two things live in IndexedDB: the app's whole state (storage.ts) and the
// backup file handle (backup.ts). Handles are structured-cloneable but not
// JSON-serializable, so they never had a home in localStorage; the app state
// moved here because localStorage caps out at ~5 MB per origin and the seeded
// question bank alone was using most of it.
//
// No library: the surface actually needed is get/put/remove on one key space.

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /**
   * Read, transform, and write back inside a SINGLE transaction.
   *
   * This is the difference between "save what this tab thinks the state is" and
   * "apply this change to whatever the state actually is". With a plain put(),
   * a second tab holding a ten-minute-old copy overwrites everything done in
   * the first one; here the change is applied to the current stored value, so
   * concurrent writers merge instead of clobbering.
   *
   * `apply` MUST be synchronous — an IndexedDB transaction auto-commits as soon
   * as control returns to the event loop with no pending requests, so an await
   * inside it would close the transaction before the write is queued.
   */
  update<T>(key: string, apply: (current: T | undefined) => T): Promise<T>;
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

// Connections are cached and reused. Opening per call is measurably wasteful
// when a write happens on every keystroke in the note editor, and an open
// connection is cheap to hold — the handlers below drop it from the cache the
// moment the browser or another tab invalidates it.
const connections = new Map<string, Promise<IDBDatabase>>();

function open(dbName: string, storeName: string): Promise<IDBDatabase> {
  const cacheKey = `${dbName}/${storeName}`;
  const cached = connections.get(cacheKey);
  if (cached) return cached;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading, or the browser reclaiming storage, closes this
      // connection out from under us. Forget it so the next call reopens
      // rather than failing forever against a dead handle.
      db.onclose = () => connections.delete(cacheKey);
      db.onversionchange = () => {
        db.close();
        connections.delete(cacheKey);
      };
      resolve(db);
    };
    request.onerror = () => {
      connections.delete(cacheKey);
      reject(request.error ?? new Error(`Couldn't open IndexedDB database "${dbName}".`));
    };
    request.onblocked = () => {
      connections.delete(cacheKey);
      reject(new Error(`Opening "${dbName}" is blocked by another tab.`));
    };
  });

  connections.set(cacheKey, opening);
  return opening;
}

/**
 * Run one request inside its own transaction.
 *
 * Deliberately resolves on the TRANSACTION completing rather than on the
 * request succeeding: a put() reports success as soon as it is queued, and a
 * write that busts the storage quota only fails later, when the transaction
 * tries to commit. Resolving early would report a save that never landed.
 */
function run<T>(
  dbName: string,
  storeName: string,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open(dbName, storeName).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = body(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? request.error ?? new Error("IndexedDB write failed."));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
      }),
  );
}

/**
 * Read-modify-write in one transaction. See KeyValueStore.update.
 *
 * The get and the put are issued on the same transaction object, so nothing
 * can interleave between them: IndexedDB will not start a second overlapping
 * readwrite transaction on the store until this one commits.
 */
function update<T>(
  dbName: string,
  storeName: string,
  key: string,
  apply: (current: T | undefined) => T,
): Promise<T> {
  return open(dbName, storeName).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const objectStore = tx.objectStore(storeName);
        const get = objectStore.get(key);
        let next: T;
        get.onsuccess = () => {
          try {
            next = apply(get.result as T | undefined);
          } catch (err) {
            // A throwing transform must not leave a half-applied write behind.
            tx.abort();
            reject(err);
            return;
          }
          objectStore.put(next, key);
        };
        tx.oncomplete = () => resolve(next);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB update failed."));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
      }),
  );
}

/** A key-value view over one object store. Errors reject; callers decide. */
export function keyValueStore(dbName: string, storeName: string): KeyValueStore {
  return {
    get: <T,>(key: string) => run<T | undefined>(dbName, storeName, "readonly", (s) => s.get(key)),
    put: (key: string, value: unknown) =>
      run<IDBValidKey>(dbName, storeName, "readwrite", (s) => s.put(value, key)).then(() => undefined),
    remove: (key: string) =>
      run<undefined>(dbName, storeName, "readwrite", (s) => s.delete(key)).then(() => undefined),
    update: <T,>(key: string, apply: (current: T | undefined) => T) =>
      update<T>(dbName, storeName, key, apply),
  };
}
