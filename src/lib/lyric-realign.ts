import type { LyricLine } from '../types/domain'

/**
 * 歌词换成另一版本的行（如 AMLL 逐字）后，把原行上的翻译/音译挪到新行上。
 * 两个版本的行起点常差 0.3~2s，还会把两句合成一句或把一句拆开，单靠时间对齐会大面积丢行。
 * 这里先按歌词文本把原行顺序对应到新行：合并的行把各原行的翻译/音译用空格拼起来，
 * 拆开的行只在第一段显示整句；文本对不上的行再按时间放宽对齐。
 */
const RELAXED_TOLERANCE_SEC = 2
/** 文本对不上时向后最多跳过几句原行重新同步（新版本可能删掉了个别行）。 */
const RESYNC_LOOKAHEAD = 3

const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

interface Cursor { line: number; offset: number }

/** 从 cursor 起把原行文本视作连续字符流，target 能完整匹配时返回触及的原行和新位置。 */
function matchStream(olds: readonly string[], from: Cursor, target: string): { touched: number[]; next: Cursor } | null {
  let { line, offset } = from
  let pos = 0
  const touched: number[] = []
  while (pos < target.length) {
    while (line < olds.length && offset >= olds[line].length) { line += 1; offset = 0 }
    if (line >= olds.length) return null
    const take = Math.min(olds[line].length - offset, target.length - pos)
    if (olds[line].slice(offset, offset + take) !== target.slice(pos, pos + take)) return null
    touched.push(line)
    pos += take
    offset += take
  }
  return { touched, next: { line, offset } }
}

/**
 * @param oldMain 原歌词行
 * @param newMain 新歌词行
 * @param companion 与 oldMain 等长的翻译或音译行
 * @returns 与 newMain 等长的翻译或音译行；companion 全空时返回空数组
 */
export function realignCompanionLines(oldMain: readonly LyricLine[], newMain: readonly LyricLine[], companion: readonly LyricLine[]): LyricLine[] {
  if (!companion.some(line => line.text)) return []
  const olds = oldMain.map(line => normalize(line.text))
  const texts = oldMain.map((_, i) => companion[i]?.text ?? '')
  const used = new Set<number>()
  let cursor: Cursor = { line: 0, offset: 0 }

  const take = (indexes: number[]) => {
    const parts = [...new Set(indexes)].filter(i => !used.has(i))
    parts.forEach(i => used.add(i))
    return parts.map(i => texts[i]).filter(Boolean).join(' ')
  }

  return newMain.map(line => {
    const target = normalize(line.text)
    if (!target) return { time: line.time, text: '' }
    let hit = matchStream(olds, cursor, target)
    for (let skip = 1; !hit && skip <= RESYNC_LOOKAHEAD; skip++) {
      hit = matchStream(olds, { line: cursor.line + skip, offset: 0 }, target)
    }
    if (hit) {
      cursor = hit.next
      return { time: line.time, text: take(hit.touched) }
    }
    let best = -1
    let bestDiff = Infinity
    oldMain.forEach((old, i) => {
      const diff = Math.abs(old.time - line.time)
      if (texts[i] && !used.has(i) && diff < bestDiff) { best = i; bestDiff = diff }
    })
    return { time: line.time, text: best >= 0 && bestDiff <= RELAXED_TOLERANCE_SEC ? take([best]) : '' }
  })
}
