/**
 * 歌词换行单元：逐字歌词的每个 token 是独立排版元素，浏览器的避头尾规则不再生效，
 * 词组也会被从中间拆开。这里把相邻 token 按中文词组归并成不可拆的单元，
 * 闭合标点粘在前一个单元末尾、开启标点粘在后一个单元开头，只允许在单元之间换行。
 */

/** 不能出现在行首的标点（粘到前面）。 */
const CLOSING = new Set(Array.from('，。、；：？！…—）》」』】〉’”,.;:?!)]}~～·%'))
/** 不能出现在行尾的标点（粘到后面）。 */
const OPENING = new Set(Array.from('（《「『【〈‘“([{'))
/** 单元过长时放弃整体不拆，避免分词器给出的长片段撑破一行。 */
const MAX_UNIT_CHARS = 8

let segmenter: Intl.Segmenter | null | undefined
function wordSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null
  }
  return segmenter
}

/** 整句文本中允许换行的字符位置（词边界与空白处）。 */
function wordBreakOffsets(text: string): Set<number> {
  const breaks = new Set<number>()
  const seg = wordSegmenter()
  if (seg) {
    for (const part of seg.segment(text)) breaks.add(part.index)
  } else {
    // 没有分词器时退化为逐字可断，仍保留标点粘连。
    for (let i = 0; i < text.length; i++) breaks.add(i)
  }
  return breaks
}

function firstChar(text: string): string {
  return Array.from(text.trimStart())[0] ?? ''
}

function lastChar(text: string): string {
  const chars = Array.from(text.trimEnd())
  return chars[chars.length - 1] ?? ''
}

/**
 * 把 token 序列分成换行单元，返回每个单元包含的 token 下标（保持原顺序、覆盖全部 token）。
 * 只决定在哪里可以换行，不改动 token 本身及其时序。
 */
export function groupLyricBreakUnits(tokens: readonly string[]): number[][] {
  if (!tokens.length) return []
  const breaks = wordBreakOffsets(tokens.join(''))
  const groups: number[][] = [[0]]
  let offset = tokens[0].length
  let unitChars = Array.from(tokens[0]).length
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1]
    const token = tokens[i]
    const atSpace = /\s$/.test(prev) || /^\s/.test(token)
    const canBreak = (atSpace || breaks.has(offset))
      && !CLOSING.has(firstChar(token))
      && !OPENING.has(lastChar(prev))
    const tooLong = unitChars >= MAX_UNIT_CHARS && !CLOSING.has(firstChar(token))
    if (canBreak || tooLong) {
      groups.push([i])
      unitChars = 0
    } else {
      groups[groups.length - 1].push(i)
    }
    offset += token.length
    unitChars += Array.from(token).length
  }
  return groups
}

/** 允许在其前面换行的 token 下标（不含 0）。 */
export function lyricBreakPoints(tokens: readonly string[]): Set<number> {
  return new Set(groupLyricBreakUnits(tokens).slice(1).map((group) => group[0]))
}
