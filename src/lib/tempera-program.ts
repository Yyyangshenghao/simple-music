import { groupLyricBreakUnits } from './lyric-line-break'
import { seededRandom, type StyleWord } from './lyric-style-layouts'

/**
 * 凝彩：平涂色块 + 网点线条的歌词 PV。整首歌预先编译成一串“镜头”（shot）：
 * 每句按词组切成 2–4 组一镜（也可整句一镜），镜头之间沿统一流向接力推进，间奏插入无字的过场镜头。
 * 这里全是与渲染无关的纯函数：编译、构图几何、文字排版与逐字运动，同一首歌、同一时间结果固定。
 */

export type TemperaKind = 'split' | 'band' | 'frame' | 'poster' | 'disc' | 'stripes' | 'triangle' | 'blank' | 'sparse'
const LYRIC_KINDS: TemperaKind[] = ['split', 'band', 'frame', 'poster', 'disc', 'stripes', 'triangle', 'sparse', 'blank']
const BRIDGE_KINDS: TemperaKind[] = ['stripes', 'disc', 'triangle', 'sparse']

export type EnterStyle = 'slide' | 'left' | 'right' | 'up' | 'down' | 'stamp'
const ENTER_STYLES: EnterStyle[] = ['slide', 'left', 'right', 'up', 'down', 'stamp']

export interface TemperaShotWord extends StyleWord {
  enter: EnterStyle
}

export interface TemperaShot {
  /** 秒，镜头接管画面的时刻 */
  start: number
  /** 秒，下一镜接管的时刻 */
  end: number
  /** 秒，本镜最后一个字唱完的时刻；过场镜头等于 start */
  lyricEnd: number
  lineIndex: number
  /** 毫秒相对 start 的逐词时间；过场镜头为空 */
  words: TemperaShotWord[]
  kind: TemperaKind
  /** 流向（弧度，0 = 向上推进）；相邻镜头只小幅转向 */
  flow: number
  /** 构图用的随机种子 */
  seed: number
  /** 重点词下标（演唱最长的词），过场镜头为 -1 */
  hero: number
  /** 背景上的装饰大字（取自其他句子），可能为空 */
  watermark: string
}

const SLICE_MIN_UNITS = 2
const SLICE_MAX_UNITS = 4
const SLICE_TARGET_SEC = 2.2
const SLICE_MAX_SEC = 3.2
const BRIDGE_GAP_SEC = 1.2
const BRIDGE_MAX_SEC = 5
const TAIL_SEC = 2.5

const visibleLength = (text: string) => Array.from(text.replace(/\s+/g, '')).length

/** 一句按词组切镜：每镜 2–4 个词组、约 2.2 秒，最长 3.2 秒；整句模式一句一镜。 */
export function sliceLine(words: readonly StyleWord[], wholeLine: boolean): StyleWord[][] {
  if (!words.length) return []
  if (wholeLine) return [[...words]]
  const units = groupLyricBreakUnits(words.map(word => word.text)).map(unit => unit.map(i => words[i]))
  const slices: StyleWord[][] = []
  let current: StyleWord[] = []
  let unitsInSlice = 0
  for (const unit of units) {
    const start = current[0]?.startMs ?? unit[0].startMs
    const span = (unit[unit.length - 1].endMs - start) / 1000
    const chars = visibleLength([...current, ...unit].map(word => word.text).join(''))
    const full = unitsInSlice >= SLICE_MAX_UNITS || span > SLICE_MAX_SEC || chars > 12
      || (unitsInSlice >= SLICE_MIN_UNITS && span > SLICE_TARGET_SEC)
    if (current.length && full) {
      slices.push(current)
      current = []
      unitsInSlice = 0
    }
    current.push(...unit)
    unitsInSlice++
  }
  if (current.length) slices.push(current)
  // 最后一镜只剩一个单字时并回上一镜，避免一闪而过的孤字。
  if (slices.length > 1 && visibleLength(slices[slices.length - 1].map(word => word.text).join('')) <= 1) {
    slices[slices.length - 2].push(...slices.pop()!)
  }
  return slices
}

function pick<T>(random: () => number, items: readonly T[], avoid?: T): T {
  const pool = avoid === undefined || items.length < 2 ? items : items.filter(item => item !== avoid)
  return pool[Math.floor(random() * pool.length)]
}

/**
 * 编译整首歌：lines 的 time 为秒，words 为对应句的逐词时序（毫秒相对行起点）。
 * 镜头首尾相接铺满时间轴；≥1.2 秒的空隙切成 1–3 个过场镜头，间奏里画面也一直在动。
 */
export function compileTemperaProgram(lines: readonly { text: string; time: number }[], words: readonly StyleWord[][], seed: number, options: { wholeLine: boolean }): TemperaShot[] {
  const random = seededRandom(seed)
  type Draft = Omit<TemperaShot, 'end'>
  const drafts: Draft[] = []
  let flow = (random() - 0.5) * 0.3
  let lastKind: TemperaKind | undefined
  const texts = lines.map(line => line.text.trim()).filter(Boolean)
  const nextFlow = () => {
    flow = Math.max(-0.25, Math.min(0.25, flow + (random() - 0.5) * 0.18))
    return flow
  }
  lines.forEach((line, lineIndex) => {
    for (const slice of sliceLine(words[lineIndex] ?? [], options.wholeLine)) {
      const start = line.time + slice[0].startMs / 1000
      const chars = visibleLength(slice.map(word => word.text).join(''))
      // 整屏平涂的留白卡只给短句，长句放上去会挤满画面。
      const kinds = chars <= 5 ? LYRIC_KINDS : LYRIC_KINDS.filter(kind => kind !== 'blank')
      const kind = pick(random, kinds, lastKind)
      lastKind = kind
      let lastEnter: EnterStyle | undefined
      const shotWords = slice.map(word => {
        lastEnter = pick(random, ENTER_STYLES, lastEnter)
        return { text: word.text, startMs: word.startMs - slice[0].startMs, endMs: word.endMs - slice[0].startMs, enter: lastEnter }
      })
      const hero = shotWords.reduce((best, word, i) => visibleLength(word.text) && word.endMs - word.startMs > shotWords[best].endMs - shotWords[best].startMs ? i : best, 0)
      const others = texts.filter(text => text !== line.text.trim())
      drafts.push({
        start, lyricEnd: line.time + slice[slice.length - 1].endMs / 1000, lineIndex, words: shotWords, kind,
        flow: nextFlow(), seed: random() * 1e6, hero,
        watermark: others.length && random() < 0.6 ? Array.from(others[Math.floor(random() * others.length)].replace(/\s+/g, '')).slice(0, 4).join('') : '',
      })
    }
  })
  drafts.sort((a, b) => a.start - b.start)
  // 时间戳相同或交叠的镜头依次顺延，每镜至少占 0.25 秒，否则二分查找会把前一镜整镜吞掉。
  for (let i = 1; i < drafts.length; i++) {
    const minStart = drafts[i - 1].start + 0.25
    if (drafts[i].start < minStart) {
      const shift = minStart - drafts[i].start
      // 逐词时间相对镜头开始：镜头推后多少，词就提前多少，揭字仍对齐原音。
      drafts[i] = { ...drafts[i], start: minStart, words: drafts[i].words.map(word => ({ ...word, startMs: word.startMs - shift * 1000, endMs: word.endMs - shift * 1000 })) }
    }
  }
  const shots: TemperaShot[] = []
  const pushBridges = (from: number, to: number) => {
    const count = Math.min(3, Math.max(1, Math.ceil((to - from) / BRIDGE_MAX_SEC)))
    for (let i = 0; i < count; i++) {
      const kind = pick(random, BRIDGE_KINDS, lastKind)
      lastKind = kind
      const start = from + ((to - from) * i) / count
      shots.push({ start, end: from + ((to - from) * (i + 1)) / count, lyricEnd: start, lineIndex: -1, words: [], kind, flow: nextFlow(), seed: random() * 1e6, hero: -1, watermark: '' })
    }
  }
  drafts.forEach((draft, i) => {
    const next = drafts[i + 1]
    if (i === 0 && draft.start > BRIDGE_GAP_SEC) pushBridges(0, draft.start)
    if (!next) {
      shots.push({ ...draft, end: Math.max(draft.lyricEnd, draft.start + 0.25) + TAIL_SEC })
      return
    }
    // 下一镜之前空出 ≥1.2 秒：本镜在唱完后再停一小会儿，剩下的交给过场镜头。
    // 顺延过的镜头唱完时刻可能早于自己的开始，按开始时刻算，镜头至少留 0.25 秒。
    const settled = Math.max(draft.lyricEnd, draft.start + 0.25)
    const gap = next.start - settled
    if (gap >= BRIDGE_GAP_SEC) {
      const hold = Math.min(0.8, gap / 3)
      shots.push({ ...draft, end: settled + hold })
      pushBridges(settled + hold, next.start)
    } else {
      shots.push({ ...draft, end: Math.max(next.start, draft.start + 0.05) })
    }
  })
  return shots
}

/** 镜头交接时长：镜头时长的 0.3，夹在 0.4–1.1 秒。 */
export function handoffSec(shot: TemperaShot): number {
  return Math.min(1.1, Math.max(0.4, (shot.end - shot.start) * 0.3))
}

export interface ShotPlacement {
  shot: TemperaShot
  index: number
  /** 沿流向的推进量：-1 = 还在上游画外，0 = 就位，1 = 已推出画外 */
  push: number
}

/** 二分找到 t 所在的镜头（最后一个 start ≤ t 的镜头）；第一镜之前为 -1。 */
export function shotIndexAt(shots: readonly TemperaShot[], t: number): number {
  let low = 0
  let high = shots.length - 1
  if (!shots.length || t < shots[0].start) return -1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (shots[middle].start <= t) low = middle
    else high = middle - 1
  }
  return low
}

const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/**
 * t 时刻画面上的镜头：交接窗口落在下一镜开始之前，旧镜沿流向推出、新镜从上游推入，两者同屏；
 * 窗口结束时新镜正好就位，第一个字随之开唱。static 为 true 时直接硬切。
 */
export function visibleShots(shots: readonly TemperaShot[], t: number, animated: boolean): ShotPlacement[] {
  const index = shotIndexAt(shots, t)
  const next = shots[index + 1]
  const firstHandoff = shots.length ? handoffSec(shots[0]) : 0
  if (index < 0) {
    if (!animated || !shots.length || t < shots[0].start - firstHandoff) return []
    return [{ shot: shots[0], index: 0, push: -(1 - easeInOut((t - (shots[0].start - firstHandoff)) / firstHandoff)) }]
  }
  const current = shots[index]
  if (t > current.end && !next) {
    const fade = (t - current.end) / handoffSec(current)
    return fade >= 1 || !animated ? [] : [{ shot: current, index, push: easeInOut(fade) }]
  }
  if (!animated || !next) return [{ shot: current, index, push: 0 }]
  // 交接窗口不超过当前镜的时长：短镜头一上场就该完整就位，不能接手时已推出半截。
  const window = Math.min(handoffSec(next), Math.max(0.05, current.end - current.start))
  const into = t - (next.start - window)
  if (into <= 0) return [{ shot: current, index, push: 0 }]
  const k = easeInOut(Math.min(1, into / window))
  return [{ shot: current, index, push: k }, { shot: next, index: index + 1, push: k - 1 }]
}

// ---------- 构图几何 ----------

export type Tone = 1 | 2 | 3
export type TemperaShape =
  | { type: 'poly'; points: [number, number][]; tone: Tone; hole?: [number, number][] }
  | { type: 'circle'; x: number; y: number; r: number; tone: Tone; ring?: number }
  | { type: 'hatch'; points: [number, number][]; angle: number; gap: number }
  | { type: 'line'; x0: number; y0: number; x1: number; y1: number; width: number }

export interface TemperaComposition {
  shapes: TemperaShape[]
  /** 文字区域（像素）：中心与宽高 */
  region: { x: number; y: number; w: number; h: number }
}

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/**
 * 一镜的构图：形状随 grow（0..1，色块入场进度）从画外/边缘长出；坐标为舞台像素。
 * 色块一律压到画框外，读作“大到装不下”，字压在色块边缘上，跨过明暗分界时会被切成两色。
 */
export function temperaComposition(shot: TemperaShot, width: number, height: number, grow: number, decor: boolean): TemperaComposition {
  const random = seededRandom(shot.seed)
  const g = Math.max(0, Math.min(1, grow))
  const W = width
  const H = height
  const side = random() < 0.5 ? -1 : 1
  const tilt = (random() - 0.5) * 0.5
  const shapes: TemperaShape[] = []
  let region = { x: W / 2, y: H * 0.46, w: W * 0.74, h: H * 0.44 }
  switch (shot.kind) {
    case 'split': {
      // 一刀斜切：分界线穿过文字中部，下半整块平涂，从侧边扫进来。
      const y = H * (0.5 + (random() - 0.5) * 0.12)
      const slope = Math.tan(tilt) * W
      const sweep = (1 - g) * W * 1.2 * side
      shapes.push({ type: 'poly', tone: 3, points: [[-W * 0.2 + sweep, y - slope / 2], [W * 1.2 + sweep, y + slope / 2], [W * 1.2 + sweep, H * 1.2], [-W * 0.2 + sweep, H * 1.2]] })
      region = { x: W / 2, y, w: W * 0.78, h: H * 0.42 }
      break
    }
    case 'band': {
      const y = H * (0.42 + random() * 0.12)
      const half = H * (0.1 + random() * 0.05)
      const reach = W * 1.3 * g
      const x0 = side > 0 ? -W * 0.15 : W * 1.15 - reach
      shapes.push({ type: 'poly', tone: 3, points: [[x0, y - half], [x0 + reach, y - half + Math.tan(tilt) * reach * 0.2], [x0 + reach, y + half + Math.tan(tilt) * reach * 0.2], [x0, y + half]] })
      if (decor) shapes.push({ type: 'hatch', points: rect(-W * 0.1, y + half + H * 0.04, W * 1.1 * g, y + half + H * 0.12), angle: Math.PI / 4, gap: H * 0.014 })
      region = { x: W / 2, y, w: W * 0.8, h: half * 2.6 }
      break
    }
    case 'frame': {
      // 满出血底板挖一个窗，字骑在窗口下沿；底板由大缩小落定。
      const scale = 1 + (1 - g) * 0.6
      const cx = W / 2
      const cy = H * 0.46
      const ww = W * 0.36 * scale
      const wh = H * 0.24 * scale
      // 底板只比画面略大：交接时随镜头推出画外，不能大到推出去还盖着整屏。
      shapes.push({ type: 'poly', tone: 2, points: rect(-W * 0.1, -H * 0.15, W * 1.1, H * 1.15), hole: rect(cx - ww, cy - wh, cx + ww, cy + wh) })
      region = { x: cx, y: cy + wh * 0.9, w: W * 0.84, h: H * 0.36 }
      break
    }
    case 'poster': {
      // 一侧大面积竖版块伸出画外，另一角一个小方块呼应。
      const edge = W * (0.4 + random() * 0.12)
      const reach = edge * g
      const points = side > 0 ? rect(-W * 0.2, -H * 0.2, reach, H * 1.2) : rect(W - reach, -H * 0.2, W * 1.2, H * 1.2)
      shapes.push({ type: 'poly', tone: 3, points })
      const s = H * 0.12 * g
      const sx = side > 0 ? W * 0.82 : W * 0.12
      shapes.push({ type: 'poly', tone: 2, points: rect(sx, H * 0.16, sx + s, H * 0.16 + s) })
      region = { x: side > 0 ? edge : W - edge, y: H * 0.5, w: W * 0.7, h: H * 0.46 }
      break
    }
    case 'disc': {
      const r = H * (0.36 + random() * 0.12) * (0.2 + 0.8 * g)
      const cx = W * (0.5 + side * (0.12 + random() * 0.1))
      const cy = H * (0.5 + (random() - 0.5) * 0.12)
      shapes.push({ type: 'circle', x: cx, y: cy, r, tone: 3 })
      if (decor) shapes.push({ type: 'circle', x: cx, y: cy, r: r * 1.18, tone: 1, ring: Math.max(1, H * 0.003) })
      region = { x: cx - side * r * 0.5, y: cy, w: W * 0.74, h: H * 0.42 }
      break
    }
    case 'stripes': {
      // 几条斜向平行带贯穿画面，依次铺开。
      const count = 3 + Math.floor(random() * 3)
      const angle = Math.PI / 5 * side + tilt
      const pitch = W / count
      const thickness = pitch * (0.32 + random() * 0.2)
      for (let i = 0; i < count; i++) {
        const local = Math.max(0, Math.min(1, g * (count + 1) - i))
        if (!local) continue
        const cx = pitch * (i + 0.5)
        const dx = Math.sin(angle) * H
        const half = thickness / 2
        const len = local * H * 1.5
        const tone: Tone = i % 2 ? 2 : 3
        shapes.push({ type: 'poly', tone, points: [[cx - half - dx, H / 2 - len], [cx + half - dx, H / 2 - len], [cx + half + dx, H / 2 + len], [cx - half + dx, H / 2 + len]] })
      }
      break
    }
    case 'triangle': {
      // 从一角压进来的巨型三角，顶点刚好顶到文字区下沿。
      const apexX = W * (0.5 + side * 0.18)
      const apexY = H * (0.62 + (1 - g) * 0.6)
      shapes.push({ type: 'poly', tone: 3, points: [[apexX, apexY], [apexX + W * 0.9, H * 1.3], [apexX - W * 0.9, H * 1.3]] })
      if (decor) shapes.push({ type: 'line', x0: -W * 0.1, y0: apexY, x1: W * 1.1, y1: apexY, width: Math.max(1, H * 0.002) })
      region = { x: W / 2, y: H * 0.5, w: W * 0.8, h: H * 0.4 }
      break
    }
    case 'blank': {
      // 整屏平涂的留白卡：字直接压在色面上。
      const reach = H * 1.4 * g
      shapes.push({ type: 'poly', tone: 3, points: rect(-W * 0.1, H * 1.2 - reach, W * 1.1, H * 1.2) })
      region = { x: W / 2, y: H * 0.47, w: W * 0.7, h: H * 0.5 }
      break
    }
    case 'sparse':
      if (decor) {
        const y = H * (0.3 + random() * 0.4)
        shapes.push({ type: 'hatch', points: rect(W * 0.05, y - H * 0.06, W * (0.05 + 0.9 * g), y + H * 0.06), angle: -Math.PI / 4, gap: H * 0.012 })
      }
      break
  }
  return { shapes, region }
}

// ---------- 文字排版与逐字运动 ----------

export interface TemperaGlyphRun {
  word: number
  text: string
  /** 相对文字区中心的左端与基线 */
  x: number
  y: number
  size: number
  width: number
}

/**
 * 拼贴排版：重点词放大 1.45 倍、其余压到 0.82 倍形成视觉重心，行距紧凑；
 * 只在原文有空白处留空，按区域宽度换行，放不下整体缩小。
 */
export function layoutShotText(words: readonly { text: string }[], hero: number, region: { w: number; h: number }, baseSize: number, measure: (text: string, size: number) => number): TemperaGlyphRun[] {
  const sizes = words.map((_, i) => baseSize * (i === hero && words.length > 1 ? 1.45 : words.length > 1 ? 0.82 : 1.2))
  const attempt = (scale: number) => {
    const rows: { runs: Omit<TemperaGlyphRun, 'y'>[]; width: number; size: number }[] = []
    let row: { runs: Omit<TemperaGlyphRun, 'y'>[]; width: number; size: number } = { runs: [], width: 0, size: 0 }
    words.forEach((word, i) => {
      const size = sizes[i] * scale
      const text = row.runs.length ? word.text : word.text.trimStart()
      const width = measure(text.trimEnd(), size)
      const space = /\s$/.test(text) ? size * 0.28 : size * 0.035
      if (row.runs.length && row.width + width > region.w) {
        rows.push(row)
        row = { runs: [], width: 0, size: 0 }
      }
      row.runs.push({ word: i, text: text.trimEnd(), x: row.width, size, width })
      row.width += width + space
      row.size = Math.max(row.size, size)
    })
    if (row.runs.length) rows.push(row)
    // 行宽不计末尾词后的间距，居中才准。
    for (const r of rows) {
      const last = r.runs[r.runs.length - 1]
      if (last) r.width = last.x + last.width
    }
    const heights = rows.map(r => r.size * 1.06)
    return { rows, height: heights.reduce((a, b) => a + b, 0), width: Math.max(0, ...rows.map(r => r.width)) }
  }
  let scale = 1
  let result = attempt(scale)
  for (let pass = 0; pass < 8 && (result.height > region.h || result.width > region.w); pass++) {
    scale *= Math.max(0.6, Math.min(region.h / result.height, region.w / Math.max(1, result.width)) * 0.98)
    result = attempt(scale)
  }
  const runs: TemperaGlyphRun[] = []
  let y = -result.height / 2
  for (const row of result.rows) {
    y += row.size * 0.9
    const left = -row.width / 2
    for (const run of row.runs) runs.push({ ...run, x: left + run.x, y })
    y += row.size * 0.16
  }
  return runs
}

const SETTLE_BASE_SEC = 0.34
const REVEAL_MAX_SEC = 0.35
const LEAD_SEC = 0.12

export interface WordMotion {
  opacity: number
  /** 位移（单位：字号），叠加在落位上 */
  dx: number
  dy: number
  scale: number
  /** 入场进度 0..1；1 表示已落定 */
  settled: number
}

/**
 * 逐字入场：提前 0.12s 起跑，入场窗口 = 0.34s + (本镜唱完 − 该字开唱 − 0.34) × settle，
 * 曲线极度前重（一记果断的落字 + 长时间慢爬）；透明度在 0.35s 内到位，字在移动中始终可读。
 * 演唱中轻微鼓起。tSec、shotLyricEndSec 都相对镜头开始（与 word 的毫秒同一原点）。
 */
export function wordMotion(word: TemperaShotWord, tSec: number, shotLyricEndSec: number, flow: number, settle: number): WordMotion {
  const start = word.startMs / 1000
  const window = SETTLE_BASE_SEC + Math.max(0, shotLyricEndSec - start - SETTLE_BASE_SEC) * Math.max(0, Math.min(1, settle))
  const since = tSec - (start - LEAD_SEC)
  if (since <= 0) return { opacity: 0, dx: 0, dy: 0, scale: 1, settled: 0 }
  const q = Math.min(1, since / window)
  const eased = 1 - Math.pow(1 - q, 5)
  const remain = 1 - eased
  const opacity = Math.min(1, since / Math.min(window, REVEAL_MAX_SEC))
  const distance = 0.9
  let dx = 0
  let dy = 0
  let scale = 1
  switch (word.enter) {
    case 'slide': dx = -Math.sin(flow) * distance * remain; dy = Math.cos(flow) * distance * remain; break
    case 'left': dx = -distance * remain; break
    case 'right': dx = distance * remain; break
    case 'up': dy = distance * remain; break
    case 'down': dy = -distance * remain; break
    case 'stamp': scale = 1 + 0.6 * remain; break
  }
  const end = word.endMs / 1000
  if (tSec >= start && tSec < end) scale *= 1 + 0.05 * Math.sin(Math.PI * (tSec - start) / Math.max(0.01, end - start))
  return { opacity, dx, dy, scale, settled: eased }
}

/** 唱完后的外扩比例：随时间缓慢增至 1.055。 */
export function releaseSpread(tSec: number, lyricEndSec: number, shotEndSec: number): number {
  if (tSec <= lyricEndSec) return 1
  return 1 + 0.055 * Math.min(1, (tSec - lyricEndSec) / Math.max(0.6, shotEndSec - lyricEndSec + 1))
}
