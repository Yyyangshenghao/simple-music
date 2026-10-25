import { tokenizeForTiming } from './lyric-parser'
import { seededRandom, type StyleWord } from './lyric-style-layouts'

/**
 * 拼版（样式 ID 沿用 fume）：整首歌词拼成一张杂志版面。相邻句按时间间隔成段，每段一块，
 * 各有字号、横排或竖排与一种封面取色；块按阅读顺序从左到右、从上到下排进若干横带。
 * 这里是与渲染无关的纯函数：坐标与尺寸的单位都是“基准字号”，渲染时乘以舞台上的实际像素。
 */

/** 度量时用的像素字号；结果除以它换算成基准字号单位 */
const MEASURE_SIZE = 40
/** 版面宽度：比舞台宽，镜头才会在版面上左右穿行 */
const PAGE_WIDTH = 30
/** 横排一行最宽 */
const ROW_MAX = 14
/** 竖排一列最长：竖排只给短句，整句一列不折行 */
const COLUMN_MAX = 9
const GAP_X = 1.5
const GAP_Y = 1.1
export const ROW_LEADING = 1.3
export const COLUMN_LEADING = 1.45
/** 超过这么久的间隔就另起一块 */
const PARAGRAPH_GAP_SEC = 6
/** 一块最多几句：块小一些，版面才有大小、方向与颜色的错落 */
const PARAGRAPH_MAX_LINES = 3
const ROW_SIZES = [0.85, 1, 1.35, 1.8]
const COLUMN_SIZES = [0.9, 1, 1.25, 1.5]
/** 颜色档：0 是正文色，1–3 取封面三色 */
export const FUME_TONES = 4

export type MeasureText = (text: string, size: number) => number

export interface CollageLine {
  lineIndex: number
  /** 横排的各行；竖排只有一列 */
  rows: string[]
}

export interface CollageBlock {
  x: number
  y: number
  width: number
  height: number
  /** 相对基准字号的倍数 */
  size: number
  vertical: boolean
  tone: number
  lines: CollageLine[]
}

export interface FumeCollage {
  blocks: CollageBlock[]
  /** 每句所在的块；空句为 -1 */
  blockOf: number[]
  width: number
  height: number
}

const isSpace = (char: string) => /\s/.test(char)
/** 只含汉字、假名、谚文与全角标点（可带空格）的句子才排竖排；拉丁字母竖排要横躺，不好读。 */
const VERTICAL_TEXT = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿！-｠…·—\s]+$/u

/** 整句规范化：连续空白合成一个空格，去掉首尾空白。 */
export function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 按词换行（英文整词不拆，比一行还宽的词拆成单字）；行首行尾不留空白。宽度单位是“本块字号”。 */
function wrapRows(text: string, maxWidth: number, width: (text: string) => number): string[] {
  const tokens = tokenizeForTiming(text).flatMap(token => width(token) > maxWidth ? Array.from(token) : [token])
  const rows: string[] = []
  let current = ''
  for (const token of tokens) {
    if (current.trim() && token.trim() && width(current.trimEnd() + token) > maxWidth) {
      rows.push(current.trimEnd())
      current = ''
    }
    // 行首空白没有意义，换行后直接丢掉。
    current += !current && !token.trim() ? '' : token
  }
  if (current.trim()) rows.push(current.trimEnd())
  return rows
}

/**
 * 排版整首歌词。同一首歌、同一种子结果固定。vertical 为 false 时全部横排。
 */
export function buildFumeCollage(lines: readonly { text: string; time: number }[], measure: MeasureText, seed: number, options: { vertical: boolean }): FumeCollage {
  const random = seededRandom(seed)
  const pick = <T>(items: readonly T[]) => items[Math.min(items.length - 1, Math.floor(random() * items.length))]
  const width = (text: string) => measure(text, MEASURE_SIZE) / MEASURE_SIZE
  const blockOf = lines.map(() => -1)

  const groups: number[][] = []
  let group: number[] = []
  lines.forEach((line, index) => {
    if (!normalizeLineText(line.text)) return
    const last = group[group.length - 1]
    if (group.length && (group.length >= PARAGRAPH_MAX_LINES || line.time - lines[last].time > PARAGRAPH_GAP_SEC)) {
      groups.push(group)
      group = []
    }
    group.push(index)
  })
  if (group.length) groups.push(group)

  const blocks: CollageBlock[] = []
  let previous: CollageBlock | undefined
  for (const members of groups) {
    const texts = members.map(index => normalizeLineText(lines[index].text))
    const longest = Math.max(...texts.map(width))
    const columnSizes = COLUMN_SIZES.filter(size => longest * size <= COLUMN_MAX)
    // 竖排：只给短的纯中日韩文段落，不连着两块竖排。
    const vertical = options.vertical && !previous?.vertical && columnSizes.length > 0
      && texts.every(text => VERTICAL_TEXT.test(text)) && random() < 0.45
    // 字号：大字只给短句（整句放得进一行），相邻两块不同字号。
    const sizes = vertical ? columnSizes : ROW_SIZES.filter(size => size <= 1 || longest * size <= ROW_MAX)
    let size = pick(sizes)
    if (size === previous?.size && sizes.length > 1) size = pick(sizes.filter(other => other !== size))
    let tone = Math.floor(random() * FUME_TONES)
    if (tone === previous?.tone) tone = (tone + 1 + Math.floor(random() * (FUME_TONES - 1))) % FUME_TONES

    const blockLines = texts.map((text, i) => ({
      lineIndex: members[i],
      rows: vertical ? [text] : wrapRows(text, ROW_MAX / size, width),
    }))
    const rows = blockLines.flatMap(line => line.rows)
    const block: CollageBlock = vertical
      ? { x: 0, y: 0, width: blockLines.length * size * COLUMN_LEADING, height: longest * size, size, vertical, tone, lines: blockLines }
      : { x: 0, y: 0, width: Math.max(...rows.map(width)) * size, height: rows.length * size * ROW_LEADING, size, vertical, tone, lines: blockLines }
    for (const index of members) blockOf[index] = blocks.length
    blocks.push(block)
    previous = block
  }

  // 装进横带：一条带放不下就换下一条；带内每块随机贴顶、居中或贴底，左右间距也略有出入。
  let shelf: CollageBlock[] = []
  let cursor = random() * 1.5
  let top = 0
  const closeShelf = () => {
    const height = Math.max(...shelf.map(block => block.height))
    for (const block of shelf) block.y = top + (height - block.height) * pick([0, 0.5, 1])
    top += height + GAP_Y
    shelf = []
  }
  for (const block of blocks) {
    if (shelf.length && cursor + block.width > PAGE_WIDTH) {
      closeShelf()
      cursor = random() * 2.5
    }
    block.x = cursor
    cursor += block.width + GAP_X + random() * 1.2
    shelf.push(block)
  }
  if (shelf.length) closeShelf()

  return {
    blocks,
    blockOf,
    width: blocks.reduce((max, block) => Math.max(max, block.x + block.width), 0),
    height: Math.max(0, top - GAP_Y),
  }
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

/** 离 index 最近的有文字的句子（先往前找，再往后找）。 */
export function nearestTextLine(collage: FumeCollage, index: number): number {
  for (let i = Math.min(index, collage.blockOf.length - 1); i >= 0; i--) if (collage.blockOf[i] >= 0) return i
  for (let i = Math.max(0, index); i < collage.blockOf.length; i++) if (collage.blockOf[i] >= 0) return i
  return -1
}

export interface FumeCamera {
  x: number
  y: number
  scale: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 镜头目标：对准当前句的中心。只平移、不放大（文字保持清晰）；句子比舞台还大时才缩小到放得下。
 */
export function fumeCameraTarget(rect: Rect, stage: { width: number; height: number }): FumeCamera {
  const scale = Math.min(1, (stage.width * 0.86) / Math.max(1, rect.width), (stage.height * 0.72) / Math.max(1, rect.height))
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, scale }
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
