const IDB_DB_NAME = 'x-clipper-cache';
const IDB_STORE_NAME = 'assets';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                db.createObjectStore(IDB_STORE_NAME, { keyPath: 'fileName' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveToCache(asset: { fileName: string; blob: Blob; meta?: Record<string, unknown> }): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const putReq = store.put({ fileName: asset.fileName, blob: asset.blob, meta: asset.meta ?? {}, createdAt: Date.now() });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
    });
}

export async function getFromCache(fileName: string): Promise<{ fileName: string; blob: Blob; meta?: Record<string, unknown> } | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.get(fileName);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteFromCache(fileName: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.delete(fileName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function cleanupExpiredCache(ttlMs: number): Promise<number> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.openCursor();
        let deleted = 0;
        req.onsuccess = (ev) => {
            const cursor = (ev.target as IDBRequest).result as IDBCursorWithValue | null;
            if (!cursor) {
                resolve(deleted);
                return;
            }
            try {
                const record = cursor.value as { fileName: string; createdAt?: number };
                const createdAt = record?.createdAt ?? 0;
                if (Date.now() - createdAt > ttlMs) {
                    cursor.delete();
                    deleted++;
                }
                cursor.continue();
            } catch (err) {
                console.warn('error while scanning cache for cleanup', err);
                cursor.continue();
            }
        };
        req.onerror = () => reject(req.error);
    });
}
