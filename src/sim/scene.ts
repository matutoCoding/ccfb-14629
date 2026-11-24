// 水下环境:光照、浑浊度、雾色随水深与时辰变化
import { Vec3, v3, clamp } from "../core/math"

export interface Environment {
  hour: number // 0-24
  turbidity: number // 0-1,0 清澈 1 浑浊
  fogColor: Vec3
  fogDensity: number
  lightDir: Vec3
  ambient: number
  sunIntensity: number
}

export const computeEnvironment = (hour: number, turbidity: number, depth: number): Environment => {
  // 太阳高度角:6 点日出,18 点日落
  const elev = Math.sin(((hour - 6) / 12) * Math.PI)
  const dayLight = clamp(elev, 0, 1)
  // 光随水深衰减
  const atten = Math.exp(-depth * 0.08)
  const ambient = 0.06 + dayLight * 0.5 * atten * (1 - turbidity * 0.5)
  const sunIntensity = dayLight * atten * (1 - turbidity * 0.6)
  // 雾色:清澈偏蓝,浑浊偏绿褐;越深越暗
  const clear: Vec3 = [0.05, 0.18, 0.28]
  const murky: Vec3 = [0.16, 0.2, 0.12]
  const base = v3.lerp(clear, murky, turbidity)
  const brightness = 0.25 + dayLight * 0.75 * atten
  const fogColor = v3.scale(base, brightness)
  const fogDensity = 0.04 + turbidity * 0.35 + depth * 0.004
  // 光方向:正午垂直,早晚斜射
  const sunAz = ((hour - 12) / 12) * Math.PI
  const lightDir: Vec3 = v3.norm([Math.sin(sunAz) * 0.6, -Math.max(0.25, elev), Math.cos(sunAz) * 0.3])
  return { hour, turbidity, fogColor, fogDensity, lightDir, ambient, sunIntensity }
}
