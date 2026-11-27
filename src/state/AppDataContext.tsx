import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CalibrationProfile, CameraRig, Cage, MeasurementRecord, Settings } from '../types';
import { idb } from '../lib/db';
import { seedIfNeeded, resetDemoData } from '../lib/seed';
import { uid } from '../lib/math3d';

interface AppData {
  loading: boolean;
  cages: Cage[];
  rigs: CameraRig[];
  calibrations: CalibrationProfile[];
  measurements: MeasurementRecord[];
  settings: Settings | null;
  dataError: string | null;
  refresh: () => Promise<void>;
  saveCage: (c: Cage) => Promise<void>;
  deleteCage: (id: string) => Promise<void>;
  saveRig: (r: CameraRig) => Promise<void>;
  deleteRig: (id: string) => Promise<void>;
  saveCalibration: (c: CalibrationProfile) => Promise<void>;
  deleteCalibration: (id: string) => Promise<void>;
  addMeasurements: (rows: MeasurementRecord[]) => Promise<void>;
  deleteMeasurement: (id: string) => Promise<void>;
  updateSettings: (s: Settings) => Promise<void>;
  resetDemo: () => Promise<void>;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [cages, setCages] = useState<Cage[]>([]);
  const [rigs, setRigs] = useState<CameraRig[]>([]);
  const [calibrations, setCalibrations] = useState<CalibrationProfile[]>([]);
  const [measurements, setMeasurements] = useState<MeasurementRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, r, cal, m, s] = await Promise.all([
        idb.getAll<Cage>('cages'),
        idb.getAll<CameraRig>('rigs'),
        idb.getAll<CalibrationProfile>('calibrations'),
        idb.getAll<MeasurementRecord>('measurements'),
        idb.get<Settings>('settings', 'singleton'),
      ]);
      setCages(c.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
      setRigs(r);
      setCalibrations(cal.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
      setMeasurements(m.sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1)));
      setSettings(s ?? null);
      setDataError(null);
    } catch (err) {
      console.error('IndexedDB load failed', err);
      setDataError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    seedIfNeeded()
      .then(() => { if (!cancelled) return refresh(); })
      .catch((err) => {
        console.error('Seed failed', err);
        if (!cancelled) {
          setDataError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [refresh]);

  const value = useMemo<AppData>(() => ({
    loading, cages, rigs, calibrations, measurements, settings, dataError, refresh,
    saveCage: async (c) => { await idb.put('cages', c); await refresh(); },
    deleteCage: async (id) => {
      await idb.delete('cages', id);
      await Promise.all(rigs.filter((r) => r.cageId === id).map((r) => idb.delete('rigs', r.id)));
      await refresh();
    },
    saveRig: async (r) => { await idb.put('rigs', r); await refresh(); },
    deleteRig: async (id) => { await idb.delete('rigs', id); await refresh(); },
    saveCalibration: async (c) => { await idb.put('calibrations', c); await refresh(); },
    deleteCalibration: async (id) => { await idb.delete('calibrations', id); await refresh(); },
    addMeasurements: async (rows) => {
      const withIds = rows.map((r) => ({ ...r, id: r.id ?? uid('m'), measuredAt: r.measuredAt ?? new Date().toISOString() })) as MeasurementRecord[];
      await idb.bulkPut('measurements', withIds);
      await refresh();
    },
    deleteMeasurement: async (id) => { await idb.delete('measurements', id); await refresh(); },
    updateSettings: async (s) => { await idb.put('settings', s); setSettings(s); await refresh(); },
    resetDemo: async () => { await resetDemoData(); await refresh(); },
  }), [loading, cages, rigs, calibrations, measurements, settings, dataError, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
