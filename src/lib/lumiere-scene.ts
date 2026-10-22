import { seededRandom, type StyleWord } from './lyric-style-layouts'

/**
 * 绘光：舞台光 PV。暗场里几束光柱缓慢扫动，烟、星点、浮尘与细线稿铺底；
 * 歌词只排当前句附近几行——当前句最大居中，上一句是余光并逐渐崩解飘散，下一句是未点亮的刻字从散开处聚拢。
 * 字的亮度 = 点亮进度 × (底光 + 光柱照到该处的强度)，光柱扫到哪里，哪里的字就亮。
 * 这里是与渲染无关的纯函数，全部只由时间决定。坐标用画面比例（x 占宽、y 占高）。
 */

export type RigKind = 'top' | 'side' | 'cross' | 'spot'
const RIG_KINDS: RigKind[] = ['top', 'side', 'cross', 'spot']

export interface Beam {
  /** 光源位置（画面比例，可以在画外） */
  x: number
  y: number
  /** 光束方向（弧度，π/2 = 竖直向下） */
  angle: number
  /** 半张角（弧度） */
  spread: number
  /** 光源处半宽（画面高度比例） */
  width: number
  /** 扫动幅度（弧度）、速度与相位 */
  sweep: number
  speed: number
  phase: number
  /** 亮度 0..1 */
  power: number
  /** 0 = 主色（封面强调色），1 = 暖白 */
  warm: number
}

export interface LumiereShot {
  /** 秒 */
  start: number
  kind: RigKind
  beams: Beam[]
  seed: number
}

const SHOT_LINES = 2
const SHOT_GAP_SEC = 4

function makeBeams(kind: RigKind, random: () => number): Beam[] {
  const beam = (b: Omit<Beam, 'sweep' | 'speed' | 'phase' | 'power' | 'warm'> & Partial<Beam>): Beam => ({
    sweep: 0.06 + random() * 0.1, speed: 0.25 + random() * 0.35, phase: random() * Math.PI * 2,
    power: 0.55 + random() * 0.4, warm: random() < 0.5 ? 1 : 0, ...b,
  })
  switch (kind) {
    case 'top': {
      // 头顶一排灯：2–4 束自上而下，角度略有发散。
      const count = 2 + Math.floor(random() * 3)
      return Array.from({ length: count }, (_, i) => beam({
        x: (i + 0.5) / count + (random() - 0.5) * 0.1, y: -0.12,
        angle: Math.PI / 2 + (random() - 0.5) * 0.5, spread: 0.08 + random() * 0.08, width: 0.02 + random() * 0.03,
      }))
    }
    case 'side': {
      // 侧光：从左右两侧斜射进来，交汇在文字附近。
      const left = random() < 0.5
      return [
        beam({ x: left ? -0.1 : 1.1, y: 0.15 + random() * 0.2, angle: left ? 0.35 + random() * 0.2 : Math.PI - 0.35 - random() * 0.2, spread: 0.12 + random() * 0.08, width: 0.04 }),
        beam({ x: left ? -0.1 : 1.1, y: 0.6 + random() * 0.2, angle: left ? -0.2 - random() * 0.15 : Math.PI + 0.2 + random() * 0.15, spread: 0.08 + random() * 0.06, width: 0.03, power: 0.4 }),
      ]
    }
    case 'cross':
      // 两束从下方两角交叉向上。
      return [
        beam({ x: 0.05, y: 1.12, angle: -Math.PI / 2 + 0.45 + random() * 0.15, spread: 0.09, width: 0.03 }),
        beam({ x: 0.95, y: 1.12, angle: -Math.PI / 2 - 0.45 - random() * 0.15, spread: 0.09, width: 0.03 }),
      ]
    case 'spot':
      // 一束窄追光打在文字上，旁边一束很淡的辅光。
      return [
        beam({ x: 0.5 + (random() - 0.5) * 0.3, y: -0.15, angle: Math.PI / 2 + (random() - 0.5) * 0.2, spread: 0.05 + random() * 0.04, width: 0.015, power: 0.9, sweep: 0.03 }),
        beam({ x: random() < 0.5 ? 0.12 : 0.88, y: -0.15, angle: Math.PI / 2 + (random() - 0.5) * 0.6, spread: 0.14, width: 0.04, power: 0.3 }),
      ]
  }
}

/** 每两句（或长间奏后）换一个光位，相邻光位种类不同。 */
export function buildLumiereShots(lines: readonly { text: string; time: number }[], seed: number): LumiereShot[] {
  const random = seededRandom(seed)
  const shots: LumiereShot[] = []
  let inShot = 0
  let lastTime = -Infinity
  let lastKind: RigKind | undefined
  for (const line of lines) {
    if (!line.text.trim()) continue
    if (!shots.length || inShot >= SHOT_LINES || line.time - lastTime > SHOT_GAP_SEC) {
      const pool = RIG_KINDS.filter(kind => kind !== lastKind)
      const kind = pool[Math.floor(random() * pool.length)]
      lastKind = kind
      shots.push({ start: shots.length ? line.time : Math.min(0, line.time), kind, beams: makeBeams(kind, random), seed: random() * 1e6 })
      inShot = 0
    }
    inShot++
    lastTime = line.time
  }
  if (!shots.length) shots.push({ start: 0, kind: 'top', beams: makeBeams('top', random), seed: random() * 1e6 })
  return shots
}

/** t 时刻在用的光位及其权重：换光位时 0.8 秒交叉渐变。 */
export function activeShots(shots: readonly LumiereShot[], t: number): { shot: LumiereShot; weight: number; age: number }[] {
  let index = 0
  for (let i = 0; i < shots.length; i++) if (shots[i].start <= t) index = i
  const current = shots[index]
  const fade = Math.min(1, Math.max(0, (t - current.start) / 0.8))
  const result = [{ shot: current, weight: index === 0 ? 1 : fade, age: t - current.start }]
  if (index > 0 && fade < 1) result.unshift({ shot: shots[index - 1], weight: 1 - fade, age: t - shots[index - 1].start })
  return result
}

/** 光束在 t 时刻的方向（扫动）与长度进度（换光位后 1.2 秒从光源伸长到全长）。 */
export function beamPose(beam: Beam, age: number, animated: boolean): { angle: number; reach: number } {
  if (!animated) return { angle: beam.angle, reach: 1 }
  const reach = 1 - Math.pow(1 - Math.min(1, Math.max(0, age / 1.2)), 3)
  return { angle: beam.angle + Math.sin(age * beam.speed + beam.phase) * beam.sweep, reach }
}

/**
 * 某点受光强度（0..1）：到光束轴线的垂直距离按当处半宽软化衰减，沿光束方向缓慢衰减。
 * 与绘制用同一套几何，光柱照到哪里，哪里的字与浮尘就亮。坐标为像素。
 */
export function beamIntensity(beams: readonly Beam[], age: number, animated: boolean, x: number, y: number, width: number, height: number, weight = 1): number {
  let total = 0
  for (const beam of beams) {
    const { angle, reach } = beamPose(beam, age, animated)
    const sx = beam.x * width
    const sy = beam.y * height
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const along = (x - sx) * dx + (y - sy) * dy
    if (along <= 0) continue
    const length = height * 2.2 * reach
    if (along > length) continue
    const across = Math.abs(-(x - sx) * dy + (y - sy) * dx)
    const half = beam.width * height + along * Math.tan(beam.spread)
    const edge = Math.max(0, 1 - across / Math.max(1, half))
    total += beam.power * edge * edge * (1 - along / (height * 2.6))
  }
  return Math.min(1, total * weight)
}

// ---------- 歌词窗口 ----------

export interface WindowSlot {
  /** 相对画面中心的竖直位置（画面高度比例） */
  y: number
  scale: number
  /** 整行透明度 */
  alpha: number
  /** 横向随机偏移的权重：当前句 0（居中），其余 1 */
  xk: number
  /** 字的透明度系数：当前句按点亮进度，余光行与刻字行固定 */
  ink: number
  /** 当前句的点亮权重：1 为当前句（点亮、柔光、强调色生效），离开后逐渐退为余光 */
  focus: number
}

const SLOTS: Record<number, WindowSlot> = {
  [-3]: { y: -0.42, scale: 0.38, alpha: 0, xk: 1, ink: 0.75, focus: 0 },
  [-2]: { y: -0.32, scale: 0.46, alpha: 0.28, xk: 1, ink: 0.75, focus: 0 },
  [-1]: { y: -0.19, scale: 0.6, alpha: 0.7, xk: 1, ink: 0.75, focus: 0 },
  0: { y: 0, scale: 1, alpha: 1, xk: 0, ink: 1, focus: 1 },
  1: { y: 0.16, scale: 0.55, alpha: 0.55, xk: 1, ink: 0.5, focus: 0 },
  2: { y: 0.27, scale: 0.45, alpha: 0.25, xk: 1, ink: 0.5, focus: 0 },
  3: { y: 0.36, scale: 0.38, alpha: 0, xk: 1, ink: 0.5, focus: 0 },
}

const slotOf = (rel: number) => SLOTS[Math.max(-3, Math.min(3, rel))]
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

/**
 * 某句在窗口里的位置：rel = 句号 − 当前句号。换句后 0.6 秒内从上一个槽位滑到新槽位，
 * 位置、大小、横向偏移和亮度系数一起过渡，不会一帧跳变；最老的一行淡出、新进窗口的一行淡入。
 * rel 超出 ±3 的句子不画。
 */
export function windowSlot(rel: number, sinceSwitchSec: number, animated: boolean): WindowSlot | null {
  if (Math.abs(rel) > 3) return null
  const target = slotOf(rel)
  const k = animated ? easeOut(sinceSwitchSec / 0.6) : 1
  if (k >= 1) return target
  const from = slotOf(rel + 1)
  const mix = (key: keyof WindowSlot) => from[key] + (target[key] - from[key]) * k
  return { y: mix('y'), scale: mix('scale'), alpha: mix('alpha'), xk: mix('xk'), ink: mix('ink'), focus: mix('focus') }
}

/**
 * 一句里每个可见字（非空白）的点亮时刻（毫秒，相对行首）：取所在词的开始，词内按字数均分；
 * 至少给 80ms，点亮不至于一闪而过。
 */
export function glyphRevealTimes(words: readonly StyleWord[]): { start: number; end: number }[] {
  const times: { start: number; end: number }[] = []
  for (const word of words) {
    const chars = Array.from(word.text).filter(char => !/\s/.test(char))
    const span = Math.max(80, word.endMs - word.startMs) / Math.max(1, chars.length)
    chars.forEach((_, i) => times.push({ start: word.startMs + span * i, end: word.startMs + span * (i + 1) }))
  }
  return times
}

/** 点亮瞬间的四芒闪点：30ms 升起，之后 0.25 秒常数衰减。 */
export function sparkleEnvelope(ageSec: number): number {
  if (ageSec < 0) return 0
  if (ageSec < 0.03) return ageSec / 0.03
  return Math.exp(-(ageSec - 0.03) / 0.25)
}

/**
 * 崩解：唱过的句子在离开当前位置后，字各自沿种子方向（多数向上）漂离并转动，越往后越快；
 * 还没唱到的句子反过来，字从散开处随临近开唱逐渐聚拢。返回位移（字号为单位）、转角与透明度系数。
 */
export function glyphDrift(seed: number, index: number, phase: 'past' | 'future', amount: number, intensity: number): { dx: number; dy: number; rotate: number; fade: number } {
  const random = seededRandom(seed + index * 7.31)
  const dirX = (random() - 0.5) * 1.2
  const dirY = phase === 'past' ? -(0.5 + random()) : (random() - 0.5) * 1.6
  const spin = (random() - 0.5) * 1.4
  const k = Math.max(0, amount) * intensity
  if (phase === 'past') {
    const d = k * k * 1.8
    return { dx: dirX * d, dy: dirY * d, rotate: spin * k, fade: Math.max(0, 1 - k * 0.7) }
  }
  const d = k * 1.2
  return { dx: dirX * d, dy: dirY * d, rotate: spin * k * 0.6, fade: Math.max(0.25, 1 - k * 0.6) }
}

// ---------- 背景元素 ----------

export interface LumiereAmbient {
  stars: { x: number; y: number; size: number; phase: number; speed: number }[]
  motes: { x: number; y: number; vx: number; vy: number; size: number }[]
  bokeh: { x: number; y: number; r: number; vx: number; vy: number; alpha: number }[]
}

/** 整首歌共用的星点、浮尘与前景散景（画面比例坐标），按种子固定。 */
export function lumiereAmbient(seed: number): LumiereAmbient {
  const random = seededRandom(seed + 17)
  return {
    stars: Array.from({ length: 70 }, () => ({ x: random(), y: random(), size: 0.6 + random() * 1.4, phase: random() * Math.PI * 2, speed: 0.6 + random() * 1.8 })),
    motes: Array.from({ length: 46 }, () => ({ x: random(), y: random(), vx: (random() - 0.5) * 0.012, vy: -0.004 - random() * 0.01, size: 0.8 + random() * 1.8 })),
    bokeh: Array.from({ length: 6 }, () => ({ x: random(), y: random(), r: 0.04 + random() * 0.08, vx: (random() - 0.5) * 0.006, vy: (random() - 0.5) * 0.004, alpha: 0.04 + random() * 0.06 })),
  }
}

/** 环绕运动：位置按速度推进后对 [0,1) 取模，永远在画面里循环。 */
export const wrap01 = (value: number) => value - Math.floor(value)

export type LineArt =
  | { kind: 'circle'; x: number; y: number; r: number; filled: boolean }
  | { kind: 'triangle'; x: number; y: number; r: number; rotate: number }
  | { kind: 'sun'; x: number; y: number; r: number }

/** 每个光位一组细线稿（圆、三角、小太阳），避开画面中部的歌词带。 */
export function lumiereLineArt(shot: LumiereShot): LineArt[] {
  const random = seededRandom(shot.seed + 5)
  const count = 3 + Math.floor(random() * 3)
  const art: LineArt[] = []
  for (let i = 0; i < count; i++) {
    const x = 0.06 + random() * 0.88
    const band = random() < 0.5 ? random() * 0.28 : 0.68 + random() * 0.28
    const pick = random()
    if (pick < 0.45) art.push({ kind: 'circle', x, y: band, r: 0.03 + random() * 0.07, filled: random() < 0.35 })
    else if (pick < 0.8) art.push({ kind: 'triangle', x, y: band, r: 0.04 + random() * 0.06, rotate: random() * Math.PI })
    else art.push({ kind: 'sun', x, y: band, r: 0.018 + random() * 0.02 })
  }
  return art
}
