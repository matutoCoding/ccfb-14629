import type { CalibrationProfile, CameraRig, Cage, MeasurementRecord, Settings } from '../types';

const DB_NAME = 'offshore-stereo-fish';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cages')) db.createObjectStore('cages', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rigs')) {
        const s = db.createObjectStore('rigs', { keyPath: 'id' });
        s.createIndex('cageId', 'cageId');
      }
      if (!db.objectStoreNames.contains('calibrations')) {
        const s = db.createObjectStore('calibrations', { keyPath: 'id' });
        s.createIndex('rigId', 'rigId');
      }
      if (!db.objectStoreNames.contains('measurements')) {
        const s = db.createObjectStore('measurements', { keyPath: 'id' });
        s.createIndex('cageId', 'cageId');
        s.createIndex('rigId', 'rigId');
        s.createIndex('measuredAt', 'measuredAt');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  async getAll<T>(store: string): Promise<T[]> {
    return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },
  async get<T>(store: string, id: string): Promise<T | undefined> {
    return tx(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
  },
  async put<T>(store: string, value: T): Promise<IDBValidKey> {
    return tx(store, 'readwrite', (s) => s.put(value));
  },
  async bulkPut<T>(store: string, values: T[]): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      values.forEach((v) => s.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async delete(store: string, id: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(id));
  },
  async clear(store: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },
};

export type { Cage, CameraRig, CalibrationProfile, MeasurementRecord, Settings };
