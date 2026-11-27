export type Vec3 = [number, number, number];
export type Mat3 = number[]; // length 9, row-major
export type Mat4 = number[]; // length 16, column-major for GPU

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => norm(sub(a, b));
export function normalize(a: Vec3): Vec3 {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function rotationX(r: number): Mat3 {
  const c = Math.cos(r), s = Math.sin(r);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
export function rotationY(r: number): Mat3 {
  const c = Math.cos(r), s = Math.sin(r);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function rotationZ(r: number): Mat3 {
  const c = Math.cos(r), s = Math.sin(r);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
export function mul33(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}
export function apply33(m: Mat3, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
}

/** Rodrigues: rotation vector radians -> row-major 3x3 */
export function rodrigues(rvec: Vec3): Mat3 {
  const theta = norm(rvec);
  if (theta < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = mul(rvec, 1 / theta);
  const c = Math.cos(theta), s = Math.sin(theta), ic = 1 - c;
  return [
    c + x * x * ic, x * y * ic - z * s, x * z * ic + y * s,
    y * x * ic + z * s, c + y * y * ic, y * z * ic - x * s,
    z * x * ic - y * s, z * y * ic + x * s, c + z * z * ic,
  ];
}

export function rodriguesToVec(m: Mat3): Vec3 {
  // inverse Rodrigues
  const trace = m[0] + m[4] + m[8];
  const cos = clamp((trace - 1) / 2, -1, 1);
  const theta = Math.acos(cos);
  if (theta < 1e-10) return [0, 0, 0];
  if (Math.abs(theta - Math.PI) < 1e-8) {
    // column ordering robust fallback
    const xx = Math.sqrt(Math.max(0, (m[0] + 1) / 2));
    const yy = Math.sqrt(Math.max(0, (m[4] + 1) / 2));
    const zz = Math.sqrt(Math.max(0, (m[8] + 1) / 2));
    let axis: Vec3 = [xx, yy, zz];
    if (m[1] < 0) axis[1] = -axis[1];
    if (m[2] < 0) axis[2] = -axis[2];
    if (m[5] < 0) axis[2] = -axis[2];
    return mul(axis, theta);
  }
  const rx = m[7] - m[5];
  const ry = m[2] - m[6];
  const rz = m[3] - m[1];
  const div = 2 * Math.sin(theta);
  return [theta * rx / div, theta * ry / div, theta * rz / div];
}

export function composeEuler(yawDeg: number, pitchDeg: number, rollDeg: number): Mat3 {
  // Y yaw, X pitch, Z roll; local OpenCV-ish basis is derived by caller.
  const y = rotationY((yawDeg * Math.PI) / 180);
  const p = rotationX((pitchDeg * Math.PI) / 180);
  const r = rotationZ((rollDeg * Math.PI) / 180);
  return mul33(mul33(y, p), r);
}

export function perspectiveMat4(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  // column-major WebGPU clip space Z [0,1]
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, far * near * nf, 0,
  ];
}

export function lookAtMat4(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, target)); // GPU looks down -z
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ];
}

export function mulMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function trsMat4(pos: Vec3, rot?: Mat3, scale?: Vec3): Mat4 {
  const m = new Array(16).fill(0);
  const r = rot ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const s = scale ?? [1, 1, 1];
  // columns
  m[0] = r[0] * s[0]; m[1] = r[3] * s[0]; m[2] = r[6] * s[0]; m[3] = 0;
  m[4] = r[1] * s[1]; m[5] = r[4] * s[1]; m[6] = r[7] * s[1]; m[7] = 0;
  m[8] = r[2] * s[2]; m[9] = r[5] * s[2]; m[10] = r[8] * s[2]; m[11] = 0;
  m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; m[15] = 1;
  return m;
}

export function deterministicRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
