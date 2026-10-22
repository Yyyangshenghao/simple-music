import { tokenizeForTiming } from './lyric-parser'
import { seededRandom, type StyleWord } from './lyric-style-layouts'

/**
 * 浮名：把整首歌词排成一篇双栏“文章”，镜头在文章里移动、对准正在唱的句子。
 * 这里是与渲染无关的纯函数：文章排版、逐字打印进度、镜头目标与跟随、装饰线条。
 * 坐标都在“文章世界”里，单位是像素，字号以 BASE_SIZE 为基准；渲染时整体缩放平移。
 */

export const FUME_BASE_SIZE = 40
/** 每栏宽度（以基准字号计约 15 个汉字） */
const COLUMN_WIDTH = FUME_BASE_SIZE * 15
const COLUMN_GAP = FUME_BASE_SIZE * 2.4
const LINE_HEIGHT = 1.55
const BLOCK_GAP = FUME_BASE_SIZE * 1.8
/** 超过这么久的间隔就另起一段 */
const PARAGRAPH_GAP_SEC = 6
/** 段落不宜过长：段落在两栏间交替，镜头才会在文章里左右穿行 */
const PARAGRAPH_MAX_LINES = 4
/** 段落字号变化，让总览时文章有大小层次 */
const BLOCK_SIZES = [1, 0.82, 1.14, 0.9]

export type MeasureText = (text: string, size: number) => number

export interface FumeRow {
  lineIndex: number
  text: string
  /** 本行第一个字在整句规范化文本里的位置（按非空白字计） */
  visibleStart: number
  /** 每个字（代码点）及其相对行首的 x 偏移 */
  glyphs: { char: string; x: number }[]
  x: number
  /** 基线 y */
  y: number
  size: number
  width: number
}

export interface FumeArticle {
  rows: FumeRow[]
  /** 每句对应的行下标；空句为空数组 */
  lineRows: number[][]
  bounds: { x0: number; y0: number; x1: number; y1: number }
}

const isSpace = (char: string) => /\s/.test(char)

/** 整句规范化：连续空白合成一个空格，去掉首尾空白。 */
export function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function wrapLine(text: string, size: number, maxWidth: number, measure: MeasureText): { text: string; glyphs: { char: string; x: number }[]; width: number; visibleStart: number }[] {
  const rows: { text: string; glyphs: { char: string; x: number }[]; width: number; visibleStart: number }[] = []
  let current = { text: '', glyphs: [] as { char: string; x: number }[], width: 0, visibleStart: 0 }
  let visible = 0
  // 比整栏还宽的单个 token（超长单词、连字符串）拆成单字，否则会越过栏距压到另一栏。
  const tokens = tokenizeForTiming(text).flatMap(token => {
    const width = Array.from(token).reduce((sum, char) => sum + measure(char, size), 0)
    return width > maxWidth ? Array.from(token) : [token]
  })
  for (const token of tokens) {
    const chars = Array.from(token)
    const tokenWidth = chars.reduce((sum, char) => sum + measure(char, size), 0)
    if (current.glyphs.length && current.width + tokenWidth > maxWidth && !isSpace(token)) {
      rows.push(current)
      current = { text: '', glyphs: [], width: 0, visibleStart: visible }
    }
    for (const char of chars) {
      // 行首空白没有意义，换行后直接丢掉。
      if (!current.glyphs.length && isSpace(char)) continue
      current.glyphs.push({ char, x: current.width })
      current.text += char
      current.width += measure(char, size)
      if (!isSpace(char)) visible++
    }
  }
  if (current.glyphs.length) rows.push(current)
  // 行尾空白不计宽度，镜头居中更准。
  for (const row of rows) {
    while (row.glyphs.length && isSpace(row.glyphs[row.glyphs.length - 1].char)) {
      const last = row.glyphs.pop()!
      row.width = last.x
      row.text = row.text.slice(0, -last.char.length)
    }
  }
  return rows
}

/**
 * 排版整首歌词：相邻句按时间间隔分段，段落在两栏间交替并错落下移；
 * 句子超出栏宽时按词换行（英文整词不拆）。同一首歌、同一种子结果固定。
 */
export function buildFumeArticle(lines: readonly { text: string; time: number }[], measure: MeasureText, seed: number): FumeArticle {
  const random = seededRandom(seed)
  const rows: FumeRow[] = []
  const lineRows: number[][] = lines.map(() => [])
  const blocks: number[][] = []
  let block: number[] = []
  lines.forEach((line, index) => {
    if (!normalizeLineText(line.text)) return
    const last = block[block.length - 1]
    if (block.length && (block.length >= PARAGRAPH_MAX_LINES || line.time - lines[last].time > PARAGRAPH_GAP_SEC)) {
      blocks.push(block)
      block = []
    }
    block.push(index)
  })
  if (block.length) blocks.push(block)

  const columnBottom = [0, 0]
  let previousTop = -Infinity
  blocks.forEach((members, blockIndex) => {
    const column = blockIndex % 2
    const size = FUME_BASE_SIZE * BLOCK_SIZES[Math.floor(random() * BLOCK_SIZES.length)]
    const x = column * (COLUMN_WIDTH + COLUMN_GAP) + (random() - 0.5) * FUME_BASE_SIZE * 1.6
    // 新段落至少比上一段低一点，两栏读起来像一篇连续向下的文章。
    let y = Math.max(columnBottom[column], previousTop + FUME_BASE_SIZE * 2.2) + size
    const top = y - size
    for (const lineIndex of members) {
      for (const wrapped of wrapLine(normalizeLineText(lines[lineIndex].text), size, COLUMN_WIDTH, measure)) {
        lineRows[lineIndex].push(rows.length)
        rows.push({ lineIndex, text: wrapped.text, visibleStart: wrapped.visibleStart, glyphs: wrapped.glyphs, x, y, size, width: wrapped.width })
        y += size * LINE_HEIGHT
      }
    }
    previousTop = top
    columnBottom[column] = y - size + BLOCK_GAP
  })

  const bounds = rows.reduce((box, row) => ({
    x0: Math.min(box.x0, row.x), y0: Math.min(box.y0, row.y - row.size),
    x1: Math.max(box.x1, row.x + row.width), y1: Math.max(box.y1, row.y + row.size * 0.3),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
  return { rows, lineRows, bounds: rows.length ? bounds : { x0: 0, y0: 0, x1: 0, y1: 0 } }
}

/** 一句里已打印的非空白字数（带小数：最后一个字正在落下）。 */
export function printedGlyphs(words: readonly StyleWord[], elapsedMs: number): number {
  let printed = 0
  for (const word of words) {
    const count = Array.from(word.text).filter(char => !isSpace(char)).length
    if (elapsedMs >= word.endMs) { printed += count; continue }
    if (elapsedMs <= word.startMs) break
    printed += count * (elapsedMs - word.startMs) / Math.max(1, word.endMs - word.startMs)
    break
  }
  return printed
}

export interface FumeCamera {
  x: number
  y: number
  scale: number
}

/** 离 index 最近的有文字的句子（先往前找，再往后找）。 */
export function nearestTextLine(article: FumeArticle, index: number): number {
  for (let i = Math.min(index, article.lineRows.length - 1); i >= 0; i--) if (article.lineRows[i]?.length) return i
  for (let i = Math.max(0, index); i < article.lineRows.length; i++) if (article.lineRows[i]?.length) return i
  return -1
}

/**
 * 镜头目标：让当前句以 displaySize 的字号出现在舞台上，过长时缩到能放下；
 * 舞台中心略偏上，给下方译文与播放栏留位置。还没开始唱时拉远看第一段。
 */
export function fumeCameraTarget(article: FumeArticle, lineIndex: number, stage: { width: number; height: number }, displaySize: number): FumeCamera | null {
  const index = nearestTextLine(article, Math.max(0, lineIndex))
  if (index < 0) return null
  const rows = article.lineRows[index].map(i => article.rows[i])
  const x0 = Math.min(...rows.map(row => row.x))
  const x1 = Math.max(...rows.map(row => row.x + row.width))
  const y0 = Math.min(...rows.map(row => row.y - row.size * 0.85))
  const y1 = Math.max(...rows.map(row => row.y + row.size * 0.25))
  let scale = displaySize / rows[0].size
  scale = Math.min(scale, (stage.width * 0.84) / Math.max(1, x1 - x0), (stage.height * 0.5) / Math.max(1, y1 - y0))
  if (lineIndex < 0) scale *= 0.62
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale }
}

/**
 * 镜头跟随：位置与缩放按指数平滑追向目标（缩放在对数空间里平滑，推拉更均匀）。
 * 返回新镜头，不修改输入。
 */
export function stepFumeCamera(camera: FumeCamera, target: FumeCamera, dtSec: number, rate = 3.2): FumeCamera {
  // 任一侧出现非有限值（例如舞台尺寸为 0）时直接用目标，避免镜头卡在 NaN。
  if (![camera.x, camera.y, camera.scale].every(Number.isFinite) || !(camera.scale > 0)) return target
  const k = 1 - Math.exp(-Math.max(0, dtSec) * rate)
  const logScale = Math.log(camera.scale) + (Math.log(target.scale) - Math.log(camera.scale)) * k
  return { x: camera.x + (target.x - camera.x) * k, y: camera.y + (target.y - camera.y) * k, scale: Math.exp(logScale) }
}

/** 镜头与目标在屏幕上相差不到半个像素，视为已停稳。 */
export function cameraSettled(camera: FumeCamera, target: FumeCamera): boolean {
  return Math.abs(camera.x - target.x) * target.scale < 0.5
    && Math.abs(camera.y - target.y) * target.scale < 0.5
    && Math.abs(camera.scale / target.scale - 1) < 0.002
}

export type FumeDecor =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'arc'; x: number; y: number; r: number; start: number; end: number }
  | { kind: 'star'; x: number; y: number; r: number; rotate: number }

/** 文章背后的细线装饰：贯穿的长直线、大圆弧与四角星，按种子固定。 */
export function fumeDecor(article: FumeArticle, seed: number): FumeDecor[] {
  const random = seededRandom(seed + 31)
  const { x0, y0, x1, y1 } = article.bounds
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const count = Math.min(40, Math.max(4, Math.round((width * height) / (COLUMN_WIDTH * COLUMN_WIDTH))))
  const decor: FumeDecor[] = []
  for (let i = 0; i < count; i++) {
    const x = x0 - width * 0.1 + random() * width * 1.2
    const y = y0 - height * 0.05 + random() * height * 1.1
    const pick = random()
    if (pick < 0.4) {
      const angle = (random() - 0.5) * Math.PI * 0.7
      const length = COLUMN_WIDTH * (1.5 + random() * 2)
      decor.push({ kind: 'line', x0: x - Math.cos(angle) * length / 2, y0: y - Math.sin(angle) * length / 2, x1: x + Math.cos(angle) * length / 2, y1: y + Math.sin(angle) * length / 2 })
    } else if (pick < 0.75) {
      const start = random() * Math.PI * 2
      decor.push({ kind: 'arc', x, y, r: COLUMN_WIDTH * (0.6 + random() * 1.2), start, end: start + Math.PI * (0.4 + random() * 0.9) })
    } else {
      decor.push({ kind: 'star', x, y, r: FUME_BASE_SIZE * (1.4 + random() * 2.2), rotate: random() * Math.PI })
    }
  }
  return decor
}
