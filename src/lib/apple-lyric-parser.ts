import type { LyricLine, WordLyricLine, WordToken } from '../types/domain'

const METADATA_NS = 'http://www.w3.org/ns/ttml#metadata'

function roleOf(element: Element): string {
  return element.getAttributeNS(METADATA_NS, 'role') ?? element.getAttribute('ttm:role') ?? ''
}

function seconds(value: string | null): number | null {
  if (!value) return null
  if (/^\d+(?:\.\d+)?ms$/.test(value)) return Number(value.slice(0, -2)) / 1000
  if (/^\d+(?:\.\d+)?s?$/.test(value)) return Number(value.replace(/s$/, ''))
  if (!/^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(value)) return null
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

/** 只读取 TTML 文本与时序，不把远端 XML 插入页面。 */
export function parseAppleLyrics(ttml: string): { main: LyricLine[]; aligned: LyricLine[]; roma: LyricLine[]; wordLines: WordLyricLine[] } {
  const empty = { main: [], aligned: [], roma: [], wordLines: [] }
  if (!ttml || ttml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(ttml)) return empty
  const doc = new DOMParser().parseFromString(ttml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return empty
  const rows: Array<{ main: LyricLine; words: WordToken[]; end: number | null; translation: string; roman: string }> = []
  const body = doc.getElementsByTagNameNS('*', 'body')[0]
  if (!body) return empty
  for (const p of Array.from(body.getElementsByTagNameNS('*', 'p'))) {
    const segments: Array<{ text: string; start: number | null; end: number | null; wordTimed: boolean }> = []
    const visit = (node: Node, start: number | null, end: number | null, wordTimed = false) => {
      if (node.nodeType === 3 || node.nodeType === 4) {
        const raw = node.nodeValue ?? ''
        if (/^\s+$/.test(raw) && /[\r\n]/.test(raw)) return
        const text = raw.replace(/\s+/g, ' ')
        if (text) segments.push({ text, start, end, wordTimed })
        return
      }
      if (node.nodeType !== 1) return
      const el = node as Element
      // 元数据中的翻译/音译不能混入正在演唱的正文。
      const role = roleOf(el)
      if (role === 'x-translation' || role === 'x-roman') return
      const begin = seconds(el.getAttribute('begin')) ?? start
      const finish = seconds(el.getAttribute('end')) ?? end
      const timedSpan = wordTimed || (el.localName === 'span' && seconds(el.getAttribute('begin')) !== null)
      if (el.localName === 'br') { segments.push({ text: ' ', start: begin, end: finish, wordTimed: timedSpan }); return }
      for (const child of Array.from(el.childNodes)) visit(child, begin, finish, timedSpan)
    }
    const lineStart = seconds(p.getAttribute('begin'))
    const lineEnd = seconds(p.getAttribute('end'))
    visit(p, null, null)
    const text = segments.map(s => s.text).join('').trim()
    const timed = segments.filter(s => s.text.trim() && s.start !== null)
    const start = lineStart ?? (timed.length ? Math.min(...timed.map(s => s.start!)) : null)
    if (!text || start === null || !Number.isFinite(start)) continue
    const end = lineEnd ?? (timed.length && timed.every(s => s.end !== null) ? Math.max(...timed.map(s => s.end!)) : null)
    if (end !== null && end <= start) continue
    const words: WordToken[] = []
    const hasWordTiming = Array.from(p.getElementsByTagNameNS('*', 'span')).some(span => span.hasAttribute('begin'))
    for (const segment of hasWordTiming ? segments : []) {
      if (!segment.text.trim() && words.length) { words[words.length - 1].text += segment.text; continue }
      if (!segment.text.trim()) continue
      if (!segment.wordTimed || segment.start === null || segment.end === null || segment.end <= segment.start) { words.length = 0; break }
      words.push({ text: segment.text, startMs: Math.max(0, (segment.start - start) * 1000), durationMs: (segment.end - segment.start) * 1000 })
    }
    if (words.length) words[words.length - 1].text = words[words.length - 1].text.trimEnd()
    const annotation = (role: string) => Array.from(p.getElementsByTagNameNS('*', 'span'))
      .filter(span => roleOf(span) === role)
      .map(span => (span.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean).join(' ')
    rows.push({ main: { time: start, text }, words, end, translation: annotation('x-translation'), roman: annotation('x-roman') })
  }
  rows.sort((a, b) => a.main.time - b.main.time)
  const main = rows.map(row => row.main)
  const aligned = rows.some(row => row.translation) ? rows.map(row => ({ time: row.main.time, text: row.translation })) : []
  const roma = rows.some(row => row.roman) ? rows.map(row => ({ time: row.main.time, text: row.roman })) : []
  const wordLines = rows.map((row, i) => {
    const end = row.end ?? main[i + 1]?.time ?? row.main.time
    const durationMs = Math.max(0, (end - row.main.time) * 1000)
    // 保留数组与正文逐行对齐；没有音节时间的行不再生成均分时间。
    return { time: row.main.time, durationMs, words: row.words }
  })
  return { main, aligned, roma, wordLines }
}
