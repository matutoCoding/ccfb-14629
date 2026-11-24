// IndexedDB 数据层:网箱/相机/标定/测量/设置
import { CamParams, NOMINAL } from "../core/camera"
import { Mat3, Vec3 } from "../core/math"

export interface Cage {
  id: string
  name: string
  circumference: number // m
  netDepth: number // m
  stockDate: string // YYYY-MM-DD
  species: string
  fishCount: number
  createdAt: number
  updatedAt: number
}

export interface CameraRig {
  id: string
  cageId: string
  name: string
  baseline: number // m(使用值,可被扰动)
  installDepth: number // m
  posAngle: number // 在网箱圆周上的角度 rad
  yawOffset: number // 相对指向圆心的偏航 rad
  used: CamParams // 测量用参数(标定结果或标称值+扰动)
  calibrated: boolean
  createdAt: number
  updatedAt: number
}

export interface Calibration {
  id: string
  cameraId: string
  date: number
  result: {
    fx: number; fy: number; cx: number; cy: number; k1: number; k2: number
    portDist: number
    relR: Mat3; relT: Vec3; baseline: number
  }
  viewErrors: { index: number; left: number; right: number; excluded: boolean }[]
  meanError: number
}

export interface Measurement {
  id: string
  cageId: string
  cameraId: string
  date: number
  type: "manual" | "auto"
  forkLength: number // cm
  weight: number // g
  confidence: number // 0-1
  fishId: string | null // 仿真鱼 id,用于真值对账
  trueLength: number | null // cm
  createdAt: number
}

export interface Settings {
  id: string // 固定 "global"
  season: "春" | "夏" | "秋" | "冬"
  lwA: Record<string, number> // 长重关系 W=a*L^b 按季节
  lwB: Record<string, number>
  waterTemp: number // ℃
  marketWeight: number // g 上市规格
  feedRates: { maxTemp: number; rate: number }[] // 按水温的日投喂率(占存鱼量)
  // 参数扰动(故意给错,观察测量偏差)
  perturb: { fxPct: number; baselinePct: number; portDist: number; nWater: number; k1: number }
}

export const DEFAULT_SETTINGS: Settings = {
  id: "global",
  season: "秋",
  lwA: { 春: 0.0165, 夏: 0.0152, 秋: 0.0178, 冬: 0.019 },
  lwB: { 春: 2.95, 夏: 2.88, 秋: 2.98, 冬: 3.02 },
  waterTemp: 20,
  marketWeight: 500,
  feedRates: [
    { maxTemp: 14, rate: 0.008 },
    { maxTemp: 18, rate: 0.012 },
    { maxTemp: 24, rate: 0.018 },
    { maxTemp: 28, rate: 0.022 },
    { maxTemp: 99, rate: 0.015 },
  ],
  perturb: { fxPct: 0, baselinePct: 0, portDist: 0, nWater: 0, k1: 0 },
}

const DB_NAME = "stereo_aqua"
const STORES = ["cages", "cameras", "calibrations", "measurements", "settings"] as const

let dbPromise: Promise<IDBDatabase> | null = null

const open = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const store = async (name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> => {
  const db = await open()
  return db.transaction(name, mode).objectStore(name)
}

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const crud = <T extends { id: string }>(name: string) => ({
  list: async (): Promise<T[]> => wrap((await store(name, "readonly")).getAll()) as Promise<T[]>,
  get: async (id: string): Promise<T | undefined> => wrap((await store(name, "readonly")).get(id)),
  put: async (item: T): Promise<void> => {
    await wrap((await store(name, "readwrite")).put(item))
  },
  remove: async (id: string): Promise<void> => {
    await wrap((await store(name, "readwrite")).delete(id))
  },
  clear: async (): Promise<void> => {
    await wrap((await store(name, "readwrite")).clear())
  },
})

export const db = {
  cages: crud<Cage>("cages"),
  cameras: crud<CameraRig>("cameras"),
  calibrations: crud<Calibration>("calibrations"),
  measurements: crud<Measurement>("measurements"),
  settings: crud<Settings>("settings"),
}

export const uid = (): string => crypto.randomUUID()

export const getSettings = async (): Promise<Settings> => {
  const s = await db.settings.get("global")
  if (s) return s
  await db.settings.put(structuredClone(DEFAULT_SETTINGS))
  return structuredClone(DEFAULT_SETTINGS)
}

// 首次运行播种示例数据
export const seedIfEmpty = async (): Promise<void> => {
  const cages = await db.cages.list()
  if (cages.length > 0) return
  const now = Date.now()
  const mk = async (name: string, circ: number, depth: number, stockDate: string, count: number, camCount: number) => {
    const cage: Cage = {
      id: uid(), name, circumference: circ, netDepth: depth, stockDate,
      species: "大黄鱼", fishCount: count, createdAt: now, updatedAt: now,
    }
    await db.cages.put(cage)
    for (let i = 0; i < camCount; i++) {
      const cam: CameraRig = {
        id: uid(), cageId: cage.id, name: `相机 ${i + 1}`,
        baseline: 0.12, installDepth: 3 + i * 1.5,
        posAngle: (i * Math.PI) / camCount, yawOffset: 0,
        used: { ...NOMINAL }, calibrated: false, createdAt: now, updatedAt: now,
      }
      await db.cameras.put(cam)
    }
  }
  await mk("1 号网箱", 40, 6, "2026-03-15", 4200, 2)
  await mk("2 号网箱", 40, 6, "2026-04-02", 3800, 1)
  await mk("3 号网箱", 50, 8, "2026-05-20", 5000, 1)
  await getSettings()
}
