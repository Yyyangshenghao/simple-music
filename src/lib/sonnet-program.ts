import { groupLyricBreakUnits } from './lyric-line-break'
import { seededRandom, type StyleWord } from './lyric-style-layouts'

/**
 * 商籁：印刷感的动态字体 PV。每句一镜（长句按词组拆成两镜），四种字体构图（竖排巨字柱 + 横排块、
 * 大小交替的堆叠、居中大字 + 读数、斜向阶梯）配一层几何线稿（日芒环、套叠菱形、六边网格、电子轨道、
 * 行星光环、线框山脉、齿轮环），再叠 HUD 读数。随拍推镜、强拍撕裂画面（推镜裂光）。
 * 这里是与渲染无关的纯函数：编译、排版、几何与镜头，同一首歌、同一时间结果固定。
 */

export type SonnetLayoutKind = 'pillar' | 'stack' | 'center' | 'diagonal'
export type SonnetGeometry = 'sunburst' | 'diamonds' | 'hexgrid' | 'orbitals' | 'planet' | 'mountains' | 'gear'
const LAYOUTS: SonnetLayoutKind[] = ['pillar', 'stack', 'center', 'diagonal']
const GEOMETRIES: SonnetGeometry[] = ['sunburst', 'diamonds', 'hexgrid', 'orbitals', 'planet', 'mountains', 'gear']

export interface SonnetShot {
  /** 秒 */
  start: number
  end: number
  lineIndex: number
  /** 毫秒，相对 start */
  words: StyleWord[]
  layout: SonnetLayoutKind
  geometry: SonnetGeometry
  /** 重点词（演唱最长、字数 ≥1） */
  hero: number
  /** 竖排巨字柱放在左侧还是右侧 */
  side: 1 | -1
  seed: number
}

const MAX_SHOT_CHARS = 14
const visible = (text: string) => Array.from(text.replace(/\s+/g, '')).length

function pick<T>(random: () => number, items: readonly T[], avoid?: T): T {
  const pool = avoid === undefined || items.length < 2 ? items : items.filter(item => item !== avoid)
  return pool[Math.floor(random() * pool.length)]
}

/** 长句在中间的词组边界拆成两镜。 */
export function splitSonnetLine(words: readonly StyleWord[]): StyleWord[][] {
  if (!words.length) return []
  const total = visible(words.map(word => word.text).join(''))
  if (total <= MAX_SHOT_CHARS) return [[...words]]
  const units = groupLyricBreakUnits(words.map(word => word.text))
  let count = 0
  let cut = units.length - 1
  for (let i = 0; i < units.length; i++) {
    count += visible(units[i].map(index => words[index].text).join(''))
    if (count >= total / 2) { cut = i + 1; break }
  }
  cut = Math.max(1, Math.min(units.length - 1, cut))
  const first = units.slice(0, cut).flat()
  return [first.map(i => words[i]), words.slice(first.length)].filter(part => part.length)
}

/** 编译整首歌：每镜从第一个词开唱时接管，到下一镜开始或唱完后 3 秒为止。 */
export function compileSonnetProgram(lines: readonly { text: string; time: number }[], words: readonly StyleWord[][], seed: number): SonnetShot[] {
  const random = seededRandom(seed)
  const drafts: Omit<SonnetShot, 'end'>[] = []
  let lastLayout: SonnetLayoutKind | undefined
  let lastGeometry: SonnetGeometry | undefined
  lines.forEach((line, lineIndex) => {
    for (const part of splitSonnetLine(words[lineIndex] ?? [])) {
      const origin = part[0].startMs
      const layout = pick(random, part.length < 2 ? LAYOUTS.filter(kind => kind !== 'pillar' && kind !== 'stack') : LAYOUTS, lastLayout)
      const geometry = pick(random, GEOMETRIES, lastGeometry)
      lastLayout = layout
      lastGeometry = geometry
      const shifted = part.map(word => ({ text: word.text, startMs: word.startMs - origin, endMs: word.endMs - origin }))
      const hero = shifted.reduce((best, word, i) => visible(word.text) && (word.endMs - word.startMs) * Math.min(3, visible(word.text)) > (shifted[best].endMs - shifted[best].startMs) * Math.min(3, visible(shifted[best].text)) ? i : best, 0)
      drafts.push({ start: line.time + origin / 1000, lineIndex, words: shifted, layout, geometry, hero, side: random() < 0.5 ? 1 : -1, seed: random() * 1e6 })
    }
  })
  drafts.sort((a, b) => a.start - b.start)
  // 同时刻开始的镜头顺延，每镜至少 0.25 秒。
  for (let i = 1; i < drafts.length; i++) {
    const minStart = drafts[i - 1].start + 0.25
    if (drafts[i].start < minStart) {
      // 逐词时间相对镜头开始：镜头推后多少，词就提前多少，揭字仍对齐原音。
      const shiftMs = (minStart - drafts[i].start) * 1000
      drafts[i] = { ...drafts[i], start: minStart, words: drafts[i].words.map(word => ({ ...word, startMs: word.startMs - shiftMs, endMs: word.endMs - shiftMs })) }
    }
  }
  return drafts.map((draft, i) => {
    const lastEnd = draft.start + Math.max(0, ...draft.words.map(word => word.endMs)) / 1000
    // 间奏太长时本镜在唱完 3 秒后收起，画面只留几何与读数。
    return { ...draft, end: Math.min(drafts[i + 1]?.start ?? Infinity, lastEnd + 3) }
  })
}

/** 最后一个 start ≤ t 的镜头；第一镜之前为 -1，最后一镜结束后也为 -1。 */
export function sonnetShotAt(shots: readonly SonnetShot[], t: number): number {
  let low = 0
  let high = shots.length - 1
  if (!shots.length || t < shots[0].start) return -1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (shots[middle].start <= t) low = middle
    else high = middle - 1
  }
  return t < shots[low].end ? low : -1
}

// ---------- 字体排版 ----------

export interface SonnetRun {
  word: number
  text: string
  /** 相对画面中心的字块中心（像素） */
  x: number
  y: number
  size: number
  /** 竖排：逐字自上而下 */
  vertical: boolean
  rotate: number
  /** 字块宽高（竖排时为列宽与列高） */
  width: number
  height: number
}

const isCjk = (text: string) => /[぀-ヿ㐀-鿿가-힯]/.test(text)

/**
 * 四种构图的排版：pillar 把重点词竖排成一根巨字柱，其余词在另一侧横排成块；stack 大小交替逐行堆叠；
 * center 整句一行居中；diagonal 沿斜线逐词下行。放不下时整体缩小。measure 返回横排宽度。
 */
export function layoutSonnetShot(shot: SonnetShot, width: number, height: number, baseSize: number, measure: (text: string, size: number) => number): SonnetRun[] {
  const random = seededRandom(shot.seed + 41)
  const words = shot.words.map(word => word.text.trim())
  const attempt = (k: number): { runs: SonnetRun[]; box: { w: number; h: number } } => {
    const runs: SonnetRun[] = []
    if (shot.layout === 'pillar') {
      const heroText = words[shot.hero]
      const heroChars = Array.from(heroText)
      const vertical = isCjk(heroText)
      const heroSize = baseSize * 1.9 * k
      const columnH = vertical ? heroChars.length * heroSize * 0.92 : heroSize
      const columnW = vertical ? heroSize : measure(heroText, heroSize)
      const others = words.map((text, i) => ({ text, i })).filter(item => item.i !== shot.hero && item.text)
      const size = baseSize * 0.62 * k
      const blockW = Math.min(width * 0.46, Math.max(size * 4, ...others.map(item => measure(item.text, size))))
      // 横排块逐行，按块宽换行。
      const lines: { text: string; i: number }[][] = [[]]
      let lineW = 0
      for (const item of others) {
        const w = measure(item.text, size)
        if (lines[lines.length - 1].length && lineW + w > blockW) { lines.push([]); lineW = 0 }
        lines[lines.length - 1].push(item)
        lineW += w + size * 0.2
      }
      const blockH = lines.filter(line => line.length).length * size * 1.25
      const gap = size * 0.8
      // 英文重点词旋转 90° 竖立：横向只占一个字号，竖向占量出的宽度。
      const footprintW = vertical ? columnW : heroSize
      const footprintH = vertical ? columnH : columnW
      const total = footprintW + gap + blockW
      const pillarX = shot.side * (total / 2 - footprintW / 2)
      runs.push({ word: shot.hero, text: heroText, x: pillarX, y: 0, size: heroSize, vertical, rotate: vertical ? 0 : -Math.PI / 2 * shot.side, width: columnW, height: columnH })
      let y = -blockH / 2 + size * 0.62
      const blockLeft = shot.side > 0 ? -total / 2 : total / 2 - blockW
      for (const line of lines.filter(line => line.length)) {
        let x = blockLeft
        for (const item of line) {
          const w = measure(item.text, size)
          runs.push({ word: item.i, text: item.text, x: x + w / 2, y, size, vertical: false, rotate: 0, width: w, height: size })
          x += w + size * 0.2
        }
        y += size * 1.25
      }
      return { runs, box: { w: total, h: Math.max(footprintH, blockH) } }
    }
    if (shot.layout === 'stack') {
      // 每行最多约 4 个字，大小交替，左对齐成一块；行距按相邻两行字号的平均值算，大小行不会叠在一起。
      const rows: number[][] = []
      let rowChars = 0
      words.forEach((text, i) => {
        if (!text) return
        const last = rows[rows.length - 1]
        if (last && rowChars + visible(text) <= 4) { last.push(i); rowChars += visible(text) }
        else { rows.push([i]); rowChars = visible(text) }
      })
      const sizes = rows.map((_, r) => baseSize * k * (r % 2 ? 0.7 : 1.15))
      const widths = rows.map((row, r) => row.reduce((sum, i) => sum + measure(words[i], sizes[r]), 0) + (row.length - 1) * sizes[r] * 0.18)
      const blockW = Math.max(0, ...widths)
      const centers: number[] = []
      sizes.forEach((size, r) => centers.push(r ? centers[r - 1] + ((sizes[r - 1] + size) / 2) * 1.06 : 0))
      const blockH = (centers[centers.length - 1] ?? 0) + (sizes[0] + sizes[sizes.length - 1]) / 2
      const offset = -(centers[centers.length - 1] ?? 0) / 2
      rows.forEach((row, r) => {
        const size = sizes[r]
        let x = -blockW / 2 + (r % 2 ? blockW * 0.08 : 0)
        for (const i of row) {
          const w = measure(words[i], size)
          runs.push({ word: i, text: words[i], x: x + w / 2, y: centers[r] + offset, size, vertical: false, rotate: 0, width: w, height: size })
          x += w + size * 0.18
        }
      })
      return { runs, box: { w: blockW * 1.1, h: blockH } }
    }
    if (shot.layout === 'diagonal') {
      const size = baseSize * 0.95 * k
      const items = words.map((text, i) => ({ text, i })).filter(item => item.text)
      const stepX = width * 0.5 / Math.max(1, items.length - 1 || 1)
      const stepY = size * 0.9
      const angle = -0.14 + (random() - 0.5) * 0.08
      const sizeOf = (i: number) => i === shot.hero ? size * 1.35 : size
      const runsW = items.map(item => measure(item.text, sizeOf(item.i)))
      items.forEach((item, n) => {
        const x = (n - (items.length - 1) / 2) * Math.min(stepX, Math.max(...runsW) * 0.9 + size * 0.2)
        const y = (n - (items.length - 1) / 2) * stepY
        runs.push({ word: item.i, text: item.text, x, y, size: sizeOf(item.i), vertical: false, rotate: angle, width: runsW[n], height: sizeOf(item.i) })
      })
      const xs = runs.map(run => [run.x - run.width / 2, run.x + run.width / 2]).flat()
      return { runs, box: { w: Math.max(...xs) - Math.min(...xs), h: items.length * stepY + size } }
    }
    // center：整句一行，重点词放大。
    const sizes = words.map((_, i) => baseSize * k * (i === shot.hero ? 1.3 : 0.95))
    const widths = words.map((text, i) => text ? measure(text, sizes[i]) : 0)
    const spaced = (i: number) => /\s$/.test(shot.words[i].text) || /^\s/.test(shot.words[i + 1]?.text ?? '')
    const gaps = words.map((text, i) => text ? sizes[i] * (spaced(i) ? 0.3 : 0.04) : 0)
    const total = widths.reduce((a, b) => a + b, 0) + gaps.slice(0, -1).reduce((a, b) => a + b, 0)
    let x = -total / 2
    words.forEach((text, i) => {
      if (!text) return
      runs.push({ word: i, text, x: x + widths[i] / 2, y: 0, size: sizes[i], vertical: false, rotate: 0, width: widths[i], height: sizes[i] })
      x += widths[i] + gaps[i]
    })
    return { runs, box: { w: total, h: Math.max(0, ...sizes) } }
  }
  let k = 1
  let result = attempt(k)
  for (let pass = 0; pass < 6; pass++) {
    const fit = Math.min(1, (width * 0.82) / Math.max(1, result.box.w), (height * 0.56) / Math.max(1, result.box.h))
    if (fit >= 0.999) break
    k *= fit * 0.98
    result = attempt(k)
  }
  return result.runs
}

// ---------- 几何线稿 ----------

export type SonnetStroke =
  | { type: 'circle'; x: number; y: number; r: number; start?: number; end?: number }
  | { type: 'ellipse'; x: number; y: number; rx: number; ry: number; rotate: number }
  | { type: 'path'; points: [number, number][]; closed?: boolean }

/**
 * 一镜的几何线稿（像素坐标，以画面中心为原点）；grow 0..1 控制描出进度，spin 为缓慢转动的角度。
 * 线稿只用细线，围着文字而不压过文字。
 */
export function sonnetGeometry(shot: SonnetShot, width: number, height: number, grow: number, spin: number): SonnetStroke[] {
  const random = seededRandom(shot.seed + 7)
  const g = Math.max(0, Math.min(1, grow))
  const R = Math.min(width, height) * (0.32 + random() * 0.08)
  const cx = (random() - 0.5) * width * 0.25
  const cy = (random() - 0.5) * height * 0.12
  const strokes: SonnetStroke[] = []
  const polygon = (x: number, y: number, r: number, sides: number, rot: number): [number, number][] =>
    Array.from({ length: sides }, (_, i) => [x + Math.cos(rot + (i * Math.PI * 2) / sides) * r, y + Math.sin(rot + (i * Math.PI * 2) / sides) * r])
  switch (shot.geometry) {
    case 'sunburst': {
      strokes.push({ type: 'circle', x: cx, y: cy, r: R, start: spin, end: spin + Math.PI * 2 * g })
      strokes.push({ type: 'circle', x: cx, y: cy, r: R * 0.82, start: -spin, end: -spin + Math.PI * 2 * g })
      const ticks = 48
      for (let i = 0; i < ticks * g; i++) {
        const a = spin + (i * Math.PI * 2) / ticks
        const long = i % 4 === 0 ? 0.16 : 0.07
        strokes.push({ type: 'path', points: [[cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 1.02], [cx + Math.cos(a) * R * (1.02 + long), cy + Math.sin(a) * R * (1.02 + long)]] })
      }
      break
    }
    case 'diamonds':
      for (let i = 0; i < 4; i++) {
        if (g * 4 < i) break
        strokes.push({ type: 'path', points: polygon(cx, cy, R * (1 - i * 0.2) * Math.min(1, g * 4 - i), 4, spin * (i % 2 ? -1 : 1) + Math.PI / 4), closed: true })
      }
      break
    case 'hexgrid': {
      const r = R * 0.22
      const cells = Math.round(19 * g)
      const ring: [number, number][] = [[0, 0]]
      for (let q = -2; q <= 2; q++) for (let s = -2; s <= 2; s++) if (Math.abs(q + s) <= 2 && (q || s)) ring.push([q, s])
      ring.slice(0, cells).forEach(([q, s]) => strokes.push({ type: 'path', points: polygon(cx + r * 1.75 * (q + s / 2), cy + r * 1.5 * s, r, 6, Math.PI / 6 + spin * 0.2), closed: true }))
      break
    }
    case 'orbitals':
      for (let i = 0; i < 3; i++) {
        if (g * 3 < i) break
        strokes.push({ type: 'ellipse', x: cx, y: cy, rx: R * Math.min(1, g * 3 - i), ry: R * 0.32, rotate: spin + (i * Math.PI) / 3 })
      }
      strokes.push({ type: 'circle', x: cx, y: cy, r: R * 0.06 * g })
      break
    case 'planet':
      strokes.push({ type: 'circle', x: cx, y: cy, r: R * 0.42 * g })
      strokes.push({ type: 'ellipse', x: cx, y: cy, rx: R * 0.8 * g, ry: R * 0.18 * g, rotate: -0.35 })
      strokes.push({ type: 'ellipse', x: cx, y: cy, rx: R * 0.95 * g, ry: R * 0.23 * g, rotate: -0.35 })
      strokes.push({ type: 'circle', x: cx, y: cy, r: R * 1.4, start: spin, end: spin + Math.PI * 1.2 * g })
      break
    case 'mountains': {
      // 线框山脉：三层折线 + 一轮太阳，压在画面下半。
      const base = height * 0.3
      for (let layer = 0; layer < 3; layer++) {
        const points: [number, number][] = []
        const count = 7 + layer * 2
        // 每个点的高度都先算出来（随机数个数固定），描出进度只决定画到哪个点，形状不会每帧跳。
        for (let i = 0; i <= count; i++) {
          const x = -width * 0.55 + (i / count) * width * 1.1
          const y = base - layer * height * 0.06 - (i % 2 ? height * (0.12 + random() * 0.1) : random() * height * 0.04)
          if (i <= count * g) points.push([x, y])
        }
        if (points.length > 1) strokes.push({ type: 'path', points })
      }
      strokes.push({ type: 'circle', x: cx, y: base - height * 0.32, r: R * 0.28 * g })
      break
    }
    case 'gear': {
      const teeth = 18
      const points: [number, number][] = []
      for (let i = 0; i < teeth * 2 * g; i++) {
        const a = spin + (i * Math.PI) / teeth
        const r = i % 2 ? R * 0.88 : R
        points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
      }
      if (points.length > 1) strokes.push({ type: 'path', points, closed: g >= 1 })
      strokes.push({ type: 'circle', x: cx, y: cy, r: R * 0.55 * g })
      strokes.push({ type: 'circle', x: cx, y: cy, r: R * 0.18 * g })
      break
    }
  }
  return strokes
}

// ---------- 镜头 ----------

/**
 * 镜头：每镜缓慢推近（camera 控制幅度）；随拍脉冲把画面再推近一点并左右交替倾斜（punch 控制幅度）。
 * beatSide 为 ±1，随每次起拍翻转。
 */
export function sonnetCamera(localSec: number, durationSec: number, pulse: number, beatSide: number, camera: number, punch: number): { scale: number; rotate: number; dx: number } {
  const progress = Math.min(1, Math.max(0, localSec / Math.max(0.1, durationSec)))
  return {
    scale: 1 + progress * 0.05 * camera + pulse * 0.045 * punch,
    rotate: beatSide * pulse * 0.018 * punch,
    dx: (progress - 0.5) * 0.02 * camera,
  }
}

/** 逐词揭示：开唱前 80ms 起快速放大落定，0.16 秒内到位。返回透明度与缩放。 */
export function sonnetWordReveal(word: StyleWord, localMs: number): { opacity: number; scale: number; sung: number } {
  const since = localMs - (word.startMs - 80)
  if (since <= 0) return { opacity: 0, scale: 1.3, sung: 0 }
  const k = Math.min(1, since / 160)
  const sung = Math.min(1, Math.max(0, (localMs - word.startMs) / Math.max(1, word.endMs - word.startMs)))
  return { opacity: k, scale: 1 + 0.3 * (1 - k) * (1 - k), sung }
}

/** HUD 时间码：mm:ss.cc */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const secs = Math.floor(total % 60)
  const centis = Math.floor((total * 100) % 100)
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}
