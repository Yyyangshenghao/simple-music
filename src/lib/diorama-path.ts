import { seededRandom } from './lyric-style-layouts'

/**
 * 镜台：歌词立在一条蜿蜒穿过雾中的路径上，镜头沿路径飞行，每句一个电影化取景。
 * 这里是与 three.js 无关的纯函数：路径点、取景、镜头随时间的位置与逐字揭示，全部只由时间决定。
 * 世界坐标：x 右、y 上、z 朝向观众；路径一路向 -z 延伸。
 */

export type Vec3 = [number, number, number]

const LINE_SPACING = 9

/** 第 i 句在路径上的位置：横向与纵向缓慢蜿蜒。 */
export function pathPoint(index: number, seed: number): Vec3 {
  const random = seededRandom(seed + 3)
  const a = 0.55 + random() * 0.3
  const b = 0.23 + random() * 0.15
  const phase = random() * Math.PI * 2
  return [Math.sin(index * a + phase) * 6, Math.sin(index * b + phase * 0.5) * 1.6, -index * LINE_SPACING]
}

/** 歌词面板的朝向（绕 y 轴，弧度）：大致朝向来路，带一点随机偏转。 */
export function lineYaw(index: number, seed: number): number {
  const prev = pathPoint(index - 1, seed)
  const here = pathPoint(index, seed)
  const random = seededRandom(seed + index * 5.3)
  return Math.atan2(prev[0] - here[0], prev[2] - here[2]) * 0.5 + (random() - 0.5) * 0.3
}

export type ShotKind = 'front' | 'low' | 'orbit' | 'high'
const SHOTS: ShotKind[] = ['front', 'low', 'orbit', 'high']

export interface CameraPose {
  position: Vec3
  target: Vec3
}

/** 第 i 句的取景：正面、低角度仰拍、侧面环绕、高处俯拍，相邻句不同。 */
export function shotKind(index: number, seed: number): ShotKind {
  const random = seededRandom(seed + index * 11.7)
  const pick = SHOTS[Math.floor(random() * SHOTS.length)]
  if (index > 0 && pick === shotKind(index - 1, seed)) return SHOTS[(SHOTS.indexOf(pick) + 1) % SHOTS.length]
  return pick
}

/**
 * 某句的镜头位姿；progress 0..1 是本句内的推进（缓慢推近或环绕），distance 控制远近。
 * fitBack 是整句面板刚好放进画面所需的最小距离：长句时镜头退到能看全整句为止，distance 只在此之上起作用。
 * 镜头始终在歌词面板的正面一侧，不会绕到背面看反字。
 */
export function shotPose(index: number, seed: number, progress: number, distance = 1, fitBack = 0): CameraPose {
  const here = pathPoint(index, seed)
  const yaw = lineYaw(index, seed)
  const p = Math.min(1, Math.max(0, progress))
  const kind = shotKind(index, seed)
  // 面板法线方向（面板朝 +z 旋转 yaw）。
  const nx = Math.sin(yaw)
  const nz = Math.cos(yaw)
  let back = 5.2 - p * 0.8
  let side = 0
  let up = 0.3
  if (kind === 'low') { up = -1.4 + p * 0.3; back = 4.6 - p * 0.5 }
  if (kind === 'high') { up = 2.4 - p * 0.4; back = 5 - p * 0.6 }
  if (kind === 'orbit') { side = -1.8 + p * 3.6; back = 5 }
  back = Math.max(back * distance, fitBack * (1 + (back - 5.2) / 5.2 * 0.5))
  const position: Vec3 = [here[0] + nx * back + nz * side, here[1] + up, here[2] + nz * back - nx * side]
  return { position, target: [here[0], here[1] + (kind === 'low' ? 0.25 : 0), here[2]] }
}

const smooth = (t: number) => t * t * (3 - 2 * t)

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * t 时刻的镜头：换句后 1.4 秒内从上一句的取景沿弧线飞到新句（中途略抬高，像一次连续的长镜头），
 * 之后在本句内缓慢推进。拖动跨多句时直接从上一句的位置飞，不经过中间句。static 时直接到位。
 * lineSec(i) 是第 i 句唱了多久：起飞点取换句那一刻镜头实际所在（上一句没飞完或没推进完也不跳），
 * 连续短句逐句往回追溯，最多 8 句。
 */
export function cameraAt(index: number, sinceSwitchSec: number, lineDurationSec: number, seed: number, distance: number, animated: boolean, fitBack: (index: number) => number = () => 0, lineSec?: (index: number) => number, depth = 0): CameraPose {
  const at = Math.max(0, index)
  const progress = animated ? sinceSwitchSec / Math.max(1, lineDurationSec) : 0.4
  const pose = shotPose(at, seed, progress, distance, fitBack(at))
  if (!animated || index <= 0) return pose
  const fly = Math.min(1, Math.max(0, sinceSwitchSec / 1.4))
  if (fly >= 1) return pose
  const prevSec = lineSec?.(at - 1)
  const from = prevSec === undefined || depth >= 8
    ? shotPose(at - 1, seed, 1, distance, fitBack(at - 1))
    : cameraAt(at - 1, prevSec, Math.max(1, prevSec), seed, distance, true, fitBack, lineSec, depth + 1)
  const k = smooth(fly)
  const lift = Math.sin(Math.PI * k) * 1.2
  const position = lerp3(from.position, pose.position, k)
  position[1] += lift
  return { position, target: lerp3(from.target, pose.target, k) }
}

/**
 * 宽 panelWidth 的面板正面完整放进画面（留 12% 边距）所需的镜头距离；vFovDeg 是垂直视角，aspect 为画面宽高比。
 */
export function fitDistance(panelWidth: number, vFovDeg: number, aspect: number): number {
  const halfH = Math.tan((vFovDeg * Math.PI) / 360) * Math.max(0.1, aspect)
  return panelWidth / 2 / (halfH * 0.88)
}

/**
 * 逐字揭示的横向位置（0..1，相对面板宽度）：已打印字数落在哪个字的右缘。
 * glyphEdges 是每个非空白字右缘在面板里的比例，按顺序排列。
 */
export function revealFraction(glyphEdges: readonly number[], printed: number): number {
  if (!glyphEdges.length || printed <= 0) return 0
  const whole = Math.min(glyphEdges.length, Math.floor(printed))
  if (whole >= glyphEdges.length) return 1
  const left = whole > 0 ? glyphEdges[whole - 1] : 0
  return left + (glyphEdges[whole] - left) * (printed - whole)
}

/** 水镜涟漪：起拍后 1.6 秒内半径从 0.4 扩到 4，透明度衰减到 0。 */
export function rippleState(ageSec: number): { radius: number; opacity: number } | null {
  if (ageSec < 0 || ageSec > 1.6) return null
  const k = ageSec / 1.6
  return { radius: 0.4 + 3.6 * (1 - Math.pow(1 - k, 2)), opacity: 0.6 * (1 - k) }
}
