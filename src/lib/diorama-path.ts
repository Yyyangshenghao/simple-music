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
  /** 绕视线的侧倾（弧度），只在转场中出现 */
  roll?: number
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
  // 低机位贴着水面仰拍（水面在句中心下方约 0.6），不钻到水下。
  if (kind === 'low') { up = -0.45 + p * 0.1; back = 4.4 - p * 0.5 }
  if (kind === 'high') { up = 2.4 - p * 0.4; back = 5 - p * 0.6 }
  if (kind === 'orbit') { side = -1.8 + p * 3.6; back = 5 }
  back = Math.max(back * distance, fitBack * (1 + (back - 5.2) / 5.2 * 0.5))
  const position: Vec3 = [here[0] + nx * back + nz * side, here[1] + up, here[2] + nz * back - nx * side]
  return { position, target: [here[0], here[1] + (kind === 'low' ? 0.25 : 0), here[2]] }
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
/** 转场缓动：起步柔、中段略提前、落位拖一条长尾，像有惯性的摇臂。 */
const glide = (t: number) => smooth(Math.pow(clamp01(t), 0.8))

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function bezier3(a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 {
  const u = 1 - t
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]]
}

/** 换句前多久提前起飞（秒）：上一句越短提前越少，最多 0.45 秒。 */
const PRE_ROLL = 0.45
/** 换句后多久落位（秒）：本句越短落得越快，0.6–1.4 秒。 */
const SETTLE = 1.4
const preRoll = (prevSec: number | undefined) => prevSec === undefined ? 0 : Math.min(PRE_ROLL, Math.max(0, prevSec) * 0.3)
const settle = (sec: number) => Math.min(SETTLE, Math.max(0.6, sec * 0.7))

interface FlightContext {
  seed: number
  distance: number
  fitBack: (index: number) => number
  lineSec?: (index: number) => number
}

/** 第 i 句唱多久：有逐句时长就用它（末句没有下一句时按 5 秒），否则用调用方给的。 */
function ownSec(ctx: FlightContext, i: number, fallback: number): number {
  if (!ctx.lineSec) return fallback
  const sec = ctx.lineSec(i)
  return Number.isFinite(sec) && sec > 0 ? sec : 5
}

/**
 * 飞向第 i 句的镜头；since 是相对第 i 句开唱的秒数，可以为负（提前起飞阶段）。
 * 起点是起飞那一刻镜头实际所在（上一句没飞完也不跳），连续短句逐句往回追溯，最多 8 句。
 */
function flight(i: number, since: number, sec: number, ctx: FlightContext, depth: number): CameraPose {
  const pose = shotPose(i, ctx.seed, since / Math.max(1, sec), ctx.distance, ctx.fitBack(i))
  if (i <= 0) return pose
  const prevSec = ctx.lineSec?.(i - 1)
  const pre = preRoll(prevSec)
  const t = (since + pre) / (pre + settle(sec))
  if (t >= 1) return pose
  const from = prevSec === undefined || depth >= 8
    ? shotPose(i - 1, ctx.seed, 1, ctx.distance, ctx.fitBack(i - 1))
    : flight(i - 1, prevSec - pre, ownSec(ctx, i - 1, prevSec), ctx, depth + 1)
  const k = glide(t)
  // 弧线：中途向两句镜头的后方拉开、抬高，像摇臂先退后推，两句同框一瞬再落到新句。
  const bx = (from.position[0] - from.target[0]) + (pose.position[0] - pose.target[0])
  const bz = (from.position[2] - from.target[2]) + (pose.position[2] - pose.target[2])
  const bl = Math.hypot(bx, bz) || 1
  const mid = lerp3(from.position, pose.position, 0.5)
  const control: Vec3 = [mid[0] + (bx / bl) * 2.2, mid[1] + 1.0, mid[2] + (bz / bl) * 2.2]
  const position = bezier3(from.position, control, pose.position, k)
  // 视线比机身先转过去一点，镜头像是被新句“牵”过去。
  const target = lerp3(from.target, pose.target, glide(t * 1.2))
  // 横移时朝运动方向轻微侧倾，落位时回正。
  const bank = Math.max(-0.045, Math.min(0.045, -(pose.position[0] - from.position[0]) * 0.008))
  return { position, target, roll: bank * Math.sin(Math.PI * k) }
}

/**
 * t 时刻的镜头。离下一句开唱不足提前量时就开始起飞，换句后 0.6–1.4 秒内沿弧线落到新句的取景，
 * 之后在本句内缓慢推进；store 的换句比歌词时间晚一点也无妨，位姿只由时间决定、跨换句连续。
 * lineSec(i) 是第 i 句唱了多久，用于提前起飞与追溯起点；不给时只在换句后飞。static 时直接到位。
 */
export function cameraAt(index: number, sinceSwitchSec: number, lineDurationSec: number, seed: number, distance: number, animated: boolean, fitBack: (index: number) => number = () => 0, lineSec?: (index: number) => number): CameraPose {
  const at = Math.max(0, index)
  if (!animated) return shotPose(at, seed, 0.4, distance, fitBack(at))
  if (index < 0) return shotPose(0, seed, sinceSwitchSec / Math.max(1, lineDurationSec), distance, fitBack(0))
  const ctx: FlightContext = { seed, distance, fitBack, lineSec }
  const own = lineSec?.(at)
  if (own !== undefined && Number.isFinite(own) && own > 0) {
    const remaining = own - sinceSwitchSec
    if (remaining < preRoll(own)) return flight(at + 1, -remaining, ownSec(ctx, at + 1, 5), ctx, 0)
  }
  return flight(at, sinceSwitchSec, ownSec(ctx, at, lineDurationSec), ctx, 0)
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
