/**
 * Offline cache using IndexedDB for structured data.
 * Caches Supabase query results so key pages work without network.
 */

const DB_NAME = 'gains-offline';
const DB_VERSION = 1;

const STORES = {
  cache: 'cache',       // key-value cache for query results
  queue: 'queue',       // pending mutations to sync when online
} as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.cache)) {
        db.createObjectStore(STORES.cache);
      }
      if (!db.objectStoreNames.contains(STORES.queue)) {
        db.createObjectStore(STORES.queue, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Cache: read/write structured data ──────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORES.cache, 'readonly');
    const req = tx.objectStore(STORES.cache).get(key);
    req.onsuccess = () => {
      const record = req.result;
      if (!record) return resolve(null);
      // Expire after 24 hours
      if (Date.now() - record.ts > 24 * 60 * 60 * 1000) return resolve(null);
      resolve(record.data as T);
    };
    req.onerror = () => resolve(null);
  });
}

export async function cacheSet(key: string, data: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.cache, 'readwrite');
    tx.objectStore(STORES.cache).put({ data, ts: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Cache keys for specific data ───────────────────────────

export function chatHistoryKey(userId: string) { return `chat-history:${userId}`; }
export function profileKey(userId: string) { return `profile:${userId}`; }
export function entitlementsKey(userId: string) { return `entitlements:${userId}`; }
export function nutritionKey(userId: string, date: string) { return `nutrition:${userId}:${date}`; }
export function nutritionSummaryKey(userId: string, date: string) { return `nutrition-summary:${userId}:${date}`; }
export function engineProgressKey(userId: string) { return `engine-progress:${userId}`; }
export function engineWorkoutsKey(userId: string) { return `engine-workouts:${userId}`; }
export function workoutLogsKey(userId: string) { return `workout-logs:${userId}`; }

// ── Offline Queue: store mutations for later sync ──────────

export interface QueuedMutation {
  type: 'edge-function' | 'supabase-insert' | 'supabase-update' | 'supabase-delete' | 'supabase-rpc';
  /** Edge function name or table name */
  target: string;
  /** Request body or row data */
  payload: unknown;
  /** When the mutation was queued */
  createdAt: number;
}

export async function enqueue(mutation: Omit<QueuedMutation, 'createdAt'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.queue, 'readwrite');
    tx.objectStore(STORES.queue).add({ ...mutation, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function drainQueue(): Promise<QueuedMutation[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORES.queue, 'readonly');
    const req = tx.objectStore(STORES.queue).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function clearQueue(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORES.queue, 'readwrite');
    tx.objectStore(STORES.queue).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function queueSize(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORES.queue, 'readonly');
    const req = tx.objectStore(STORES.queue).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
}
