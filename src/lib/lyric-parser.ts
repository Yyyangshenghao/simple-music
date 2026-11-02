import type { LyricLine, WordToken, WordLyricLine } from '../types/domain'
import { normalizeMatchText } from './match-text'

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g

function tagToSeconds(mm: string, ss: string, frac?: string): number {
  const minutes = parseInt(mm, 10) || 0
  const seconds = parseInt(ss, 10) || 0
  let fraction = 0
  if (frac) fraction = (parseInt(frac, 10) || 0) / Math.pow(10, frac.length)
  return minutes * 60 + seconds + fraction
}

/**
 * 解析 LRC 文本为按时间排序的歌词行。
 * - 一行可含多个时间标签，会展开为多行（移植自原 parseLyricText）。
 * - 无时间标签的行（含 [ar:]/[ti:] 等元信息）被忽略。
 */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const times: number[] = []
    let m: RegExpExecArray | null
    TIME_TAG.lastIndex = 0
    while ((m = TIME_TAG.exec(raw))) times.push(tagToSeconds(m[1], m[2], m[3]))
    if (!times.length) continue
    const txt = raw.replace(TIME_TAG, '').trim()
    if (!txt) continue
    for (const t of times) lines.push({ time: t, text: txt })
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

const CJK_CREDIT_ROLES = [
  '作?词', '作?曲', '编曲', '编配', '制作人?', '监制', '出品(?:人|方)?', '发行(?:方)?', '策划', '企划', '统筹',
  '混音(?:师|工程师)?', '缩混', '母带(?:处理|工程师)?', '录音(?:师|室|工程师)?', '和声(?:编写)?', '配唱', '人声(?:编辑)?',
  '吉他', '贝斯', '鼓', '键盘', '钢琴', '弦乐', '合成器', '音乐总监', '演唱', '原唱', '歌手',
]
const LATIN_CREDIT_ROLES = [
  'OP', 'SP', 'ISRC', 'Vocals? by', 'Performed by', 'Lyrics?(?: by)?', 'Lyricist', 'Written by', 'Words by', 'Music by', 'Composer', 'Composed by',
  'Arranger', 'Arranged by', 'Producer', 'Produced by', 'Mix(?:ed|ing)? by', 'Mix(?:ing)? engineer',
  'Master(?:ed|ing)? by', 'Mastering engineer', 'Record(?:ed|ing)? by', 'Recording engineer',
]
const CJK_ROLE = `(?:${CJK_CREDIT_ROLES.join('|')})`
const LATIN_ROLE = `(?:${LATIN_CREDIT_ROLES.join('|')})`
/**
 * 署名行：中文职务可连写或并列（「制作统筹」「作词/作曲」），其后只允许跟英文职务名（「编曲 Arrangement」）；
 * 英文职务须是完整写法（「Mixed by」）。再接冒号。「鼓起勇气说：」「Mix it up: …」这类正文与对唱标记「男：」都不会命中。
 */
const CREDIT_LINE = new RegExp(
  `^\\s*(?:${CJK_ROLE}(?:\\s*[/&、,，]?\\s*${CJK_ROLE})*(?:\\s+[a-z][a-z .&/-]{0,30})?|${LATIN_ROLE}(?:\\s*[/&,]\\s*${LATIN_ROLE})*)\\s*[:：]`,
  'iu',
)
const NOTICE_LINE = /未经.{0,12}许可|不得.{0,8}(?:翻唱|翻录|使用)|享有本翻译作品的著作权|版权所有/u

/**
 * 去掉歌词开头的署名块（含「歌名 - 歌手」标题行）与结尾的署名、版权声明。
 * 只认首尾连续的块（开头最多 12 行、结尾最多 4 行），正文中间的行一律保留；全部像署名时原样返回。
 */
export function stripLyricCredits<T>(lines: T[], textOf: (line: T) => string, title = ''): T[] {
  const name = titleKey(title)
  // 标题行：「歌名 - 歌手」，或只写歌名但紧跟署名行；歌名的括注（Explicit、Live 等）两边可能写得不同。
  const isTitleLine = (text: string, next = '') => {
    if (!name) return false
    const at = text.search(/\s[-–—]\s/)
    if (at > 0) return titleKey(text.slice(0, at)) === name
    return titleKey(text) === name && CREDIT_LINE.test(next)
  }
  let head = 0
  while (head < Math.min(lines.length, 12)) {
    const text = textOf(lines[head])
    // 开头的版权声明（「未经许可，不得翻唱」）只在已认出署名块之后才去掉。
    if (!CREDIT_LINE.test(text) && !(head === 0 && isTitleLine(text, lines[1] ? textOf(lines[1]) : ''))
      && !(head > 0 && NOTICE_LINE.test(text))) break
    head++
  }
  let tail = 0
  while (tail < Math.min(lines.length - head, 4)) {
    const text = textOf(lines[lines.length - 1 - tail])
    if (!CREDIT_LINE.test(text) && !NOTICE_LINE.test(text)) break
    tail++
  }
  if (!head && !tail) return lines
  return head + tail >= lines.length ? lines : lines.slice(head, lines.length - tail)
}

/** 标题比对键：去掉括注后归一化。 */
function titleKey(value: string): string {
  return normalizeMatchText(value.replace(/[(（[【][^)）\]】]*[)）\]】]/gu, ' '))
}

const PLACEHOLDER_LINE = /纯音乐.{0,4}请.{0,2}欣赏|没有填词的纯音乐|暂无歌词|^\s*(?:no lyrics?|instrumental)\s*$/iu

/** 平台用来占位的「纯音乐，请欣赏」「暂无歌词」：只有这类行时视为没有歌词。 */
export function isPlaceholderLyrics(texts: string[]): boolean {
  const lines = texts.filter(text => text.trim())
  return lines.length > 0 && lines.length <= 3 && lines.some(text => PLACEHOLDER_LINE.test(text))
}

const lineText = (line: LyricLine) => line.text
const wordLineText = (line: WordLyricLine) => line.words.map(word => word.text).join('')

/** 逐行歌词去署名。 */
export function stripLineCredits(lines: LyricLine[], title?: string): LyricLine[] {
  return stripLyricCredits(lines, lineText, title)
}

/** 逐字歌词去署名。 */
export function stripWordLineCredits(lines: WordLyricLine[], title?: string): WordLyricLine[] {
  return stripLyricCredits(lines, wordLineText, title)
}

/**
 * 将翻译行按时间对齐到主歌词行。返回与 main 等长的数组，
 * 每项为时间最接近（容差 0.3s）的翻译文本，无匹配则空字符串。
 */
export function alignTranslation(main: LyricLine[], translation: LyricLine[]): LyricLine[] {
  const tol = 0.3
  return main.map((line) => {
    let best: LyricLine | null = null
    let bestDiff = Infinity
    for (const tr of translation) {
      const diff = Math.abs(tr.time - line.time)
      if (diff < bestDiff) {
        bestDiff = diff
        best = tr
      }
    }
    return { time: line.time, text: best && bestDiff <= tol ? best.text : '' }
  })
}

/**
 * 解析网易 YRC（逐字歌词）格式。
 * 歌词行格式：[行起始Ms,行时长Ms](字绝对起始Ms,字时长Ms,0)字(…)字…
 *   - 字的起始时间是歌曲内绝对毫秒，这里转换为相对行起始的偏移；
 *   - token 可能是多字词（如英文单词），文本原样保留（含空格，用于排版）。
 * 开头若干行是 {"t":…,"c":[…]} 形式的 JSON 元信息（作词/作曲等），没有
 * [start,dur] 头，直接跳过。
 * 返回 WordLyricLine[]，按时间排序。
 */
export function parseYrc(text: string): WordLyricLine[] {
  if (!text) return []
  const lines: WordLyricLine[] = []
  const WORD_TOKEN = /\((\d+),(\d+),-?\d+\)(.*?)(?=\(\d+,\d+,-?\d+\)|$)/g
  for (const raw of String(text).split(/\r?\n/)) {
    const headerMatch = raw.match(/^\[(\d+),(\d+)\](.*)$/)
    if (!headerMatch) continue
    const lineStartMs = parseInt(headerMatch[1], 10)
    const durationMs = parseInt(headerMatch[2], 10)
    const words: WordToken[] = []
    let m: RegExpExecArray | null
    WORD_TOKEN.lastIndex = 0
    while ((m = WORD_TOKEN.exec(headerMatch[3]))) {
      const tx = m[3]
      if (!tx) continue
      words.push({
        text: tx,
        startMs: Math.max(0, parseInt(m[1], 10) - lineStartMs),
        durationMs: parseInt(m[2], 10),
      })
    }
    if (words.some(word => word.text.trim())) {
      lines.push({ time: lineStartMs / 1000, durationMs, words })
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

/**
 * QQ 明文 QRC：每个文本片段后跟 (歌曲绝对起始毫秒,持续毫秒)。
 * 支持 LyricContent XML 包装；密文和缺少完整逐字时间的行不猜测时序。
 */
export function parseQrc(text: string): WordLyricLine[] {
  const envelope = String(text || '').match(/\bLyricContent\s*=\s*(["'])([\s\S]*?)\1/)
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  const content = envelope
    ? envelope[2].replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, value: string) => {
      if (!value.startsWith('#')) return entities[value.toLowerCase()] ?? entity
      const code = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1))
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    })
    : String(text || '')
  const lines: WordLyricLine[] = []
  for (const raw of content.split(/\r?\n/)) {
    const header = raw.match(/^\[(\d+),(\d+)\](.*)$/)
    if (!header) continue
    const start = Number(header[1])
    const durationMs = Number(header[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(durationMs)) continue
    const words: WordToken[] = []
    const body = header[3]
    const timing = /\((\d+),(\d+)\)/g
    let cursor = 0
    let match: RegExpExecArray | null
    let valid = true
    while ((match = timing.exec(body))) {
      const wordStart = Number(match[1])
      const wordDuration = Number(match[2])
      if (!Number.isSafeInteger(wordStart) || !Number.isSafeInteger(wordDuration) || wordStart < start) {
        valid = false
        break
      }
      const wordText = body.slice(cursor, match.index)
      if (wordText) words.push({ text: wordText, startMs: wordStart - start, durationMs: wordDuration })
      cursor = timing.lastIndex
    }
    if (valid && !body.slice(cursor).trim() && words.some(word => word.text.trim())) {
      lines.push({ time: start / 1000, durationMs, words })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

export interface KrcLyrics {
  wordLines: WordLyricLine[]
  translation: LyricLine[]
  roma: LyricLine[]
}

function decodeKrcLanguage(value: string): { type?: unknown; lyricContent?: unknown }[] {
  try {
    const bytes = Uint8Array.from(atob(value.trim()), char => char.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { content?: unknown }
    return Array.isArray(parsed?.content) ? parsed.content : []
  } catch {
    return []
  }
}

/**
 * 酷狗明文 KRC：行头 [行起始Ms,行时长Ms]，每个字前是 <相对行起始Ms,持续Ms,0>。
 * 翻译与音译在 [language:base64(JSON)] 标签里：type 1 按行对应原文（逐行翻译），
 * type 0 按字给出音译（条数少于原文时跳过了无字的行）。
 * 个别行头时长会写成整曲时长，按最后一个字的结束时间收口，避免被当作超出曲长的错配版本。
 */
export function parseKrc(text: string): KrcLyrics {
  const all: WordLyricLine[] = []
  let language: ReturnType<typeof decodeKrcLanguage> = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const tag = raw.match(/^\[language:([^\]]*)\]\s*$/)
    if (tag) {
      language = decodeKrcLanguage(tag[1])
      continue
    }
    const header = raw.match(/^\[(\d+),(\d+)\](.*)$/)
    if (!header) continue
    const start = Number(header[1])
    const headerDuration = Number(header[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(headerDuration)) continue
    const words: WordToken[] = []
    const body = header[3]
    const timing = /<(\d+),(\d+),-?\d+>/g
    const marks: { index: number; end: number; startMs: number; durationMs: number }[] = []
    let match: RegExpExecArray | null
    while ((match = timing.exec(body))) {
      marks.push({ index: match.index, end: timing.lastIndex, startMs: Number(match[1]), durationMs: Number(match[2]) })
    }
    marks.forEach((mark, index) => {
      const wordText = body.slice(mark.end, marks[index + 1]?.index ?? body.length)
      if (wordText) words.push({ text: wordText, startMs: mark.startMs, durationMs: mark.durationMs })
    })
    const wordsEnd = Math.max(0, ...words.map(word => word.startMs + (word.durationMs ?? 0)))
    all.push({ time: start / 1000, durationMs: wordsEnd > 0 ? Math.min(headerDuration, wordsEnd) : headerDuration, words })
  }
  const hasText = (line: WordLyricLine) => line.words.some(word => word.text.trim())
  const translation: LyricLine[] = []
  const roma: LyricLine[] = []
  for (const entry of language) {
    if (!Array.isArray(entry.lyricContent) || (entry.type !== 0 && entry.type !== 1)) continue
    const rows = entry.lyricContent as unknown[]
    const targets = rows.length === all.length ? all : all.filter(hasText)
    const output = entry.type === 1 ? translation : roma
    targets.forEach((line, index) => {
      const row = rows[index]
      const value = Array.isArray(row) ? row.filter(part => typeof part === 'string').join(entry.type === 1 ? '' : ' ').replace(/\s+/g, ' ').trim() : ''
      if (value && hasText(line)) output.push({ time: line.time, text: value })
    })
  }
  const byTime = <T extends { time: number }>(lines: T[]) => lines.sort((a, b) => a.time - b.time)
  return { wordLines: byTime(all.filter(hasText)), translation: byTime(translation), roma: byTime(roma) }
}

/**
 * 把一行歌词切成 KTV token:拉丁字母/数字连写的词(含随后的空格与紧跟的标点)
 * 作为整体,其余字符(CJK、假名等)逐字。每个 token 渲染为一个不可拆分的 span,
 * 保证英文换行发生在词间空格处而不是单词中间。
 */
export function tokenizeForTiming(text: string): string[] {
  return text.match(/[\p{Script=Latin}\p{Number}'’\-.,!?;:()&]+\s*|\s+|./gu) ?? []
}

/**
 * 当没有 YRC 数据时，用 LRC 行列表估算逐字时序。
 * 行时长按 token 字符数加权均分(英文整词是一个 token)。
 * lines 是已排序的 LyricLine[]。
 */
export function estimateWordTiming(lines: LyricLine[]): WordLyricLine[] {
  return lines.map((line, i) => {
    const nextTime = lines[i + 1]?.time ?? line.time + 4
    const durationMs = Math.max(500, (nextTime - line.time) * 1000)
    const tokens = tokenizeForTiming(line.text)
    if (!tokens.length) return { time: line.time, durationMs, words: [] }
    const totalChars = tokens.reduce((n, t) => n + t.length, 0)
    const perChar = durationMs / totalChars
    let elapsed = 0
    const words: WordToken[] = tokens.map((t) => {
      const token = { text: t, startMs: Math.round(elapsed) }
      elapsed += t.length * perChar
      return token
    })
    return { time: line.time, durationMs, words }
  })
}
