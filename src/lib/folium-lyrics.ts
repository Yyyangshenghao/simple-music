import type { LyricLine, WordLyricLine } from '../types/domain'
import type { ModLine, ModSetting } from '../types/folium'

export function foliumLyrics(lines: readonly LyricLine[], words: readonly WordLyricLine[], translations: readonly LyricLine[], romanizations: readonly LyricLine[], duration: number): ModLine[] {
  return lines.map((line, index) => {
    const timed = words[index]?.time === line.time ? words[index] : undefined
    const endTime = timed && timed.durationMs > 0 ? line.time + timed.durationMs / 1000
      : lines[index + 1]?.time ?? Math.max(line.time + 4, duration)
    return {
      fullText: line.text, startTime: line.time, endTime: Math.max(line.time, endTime),
      words: timed?.words.map((word, wordIndex) => ({
        text: word.text, startTime: line.time + word.startMs / 1000,
        endTime: word.durationMs !== undefined ? line.time + (word.startMs + word.durationMs) / 1000
          : timed.words[wordIndex + 1] ? line.time + timed.words[wordIndex + 1].startMs / 1000 : endTime
      })) ?? [],
      translation: translations[index]?.text, romanization: romanizations[index]?.text
    }
  })
}

export function foliumLineIndex(lines: readonly ModLine[], time: number): number {
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (lines[middle].startTime <= time) low = middle + 1
    else high = middle
  }
  return low - 1
}

const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * 模组 iframe 发来的设置项不可信：模组能绕过沙箱内的整理直接 postMessage。
 * 这里按宿主能渲染的形状重新整理，字段类型不符的项直接丢弃。
 */
export function sanitizeModSettings(fields: unknown): ModSetting[] {
  if (!Array.isArray(fields)) return []
  const result: ModSetting[] = []
  for (const field of fields.slice(0, 40)) {
    if (!field || typeof field !== 'object') continue
    const item = field as Record<string, unknown>
    if (typeof item.key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.key)) continue
    const label = text(item.label, 160) || item.key
    if (item.type === 'number') {
      const fallback = finite(item.defaultValue)
      if (fallback === undefined) continue
      result.push({ key: item.key, type: 'number', label, defaultValue: fallback, min: finite(item.min), max: finite(item.max), step: finite(item.step) })
    } else if (item.type === 'boolean') {
      if (typeof item.defaultValue !== 'boolean') continue
      result.push({ key: item.key, type: 'boolean', label, defaultValue: item.defaultValue })
    } else if (item.type === 'select') {
      const options = (Array.isArray(item.options) ? item.options : []).slice(0, 40)
        .filter((option): option is Record<string, unknown> => !!option && typeof option === 'object' && typeof (option as Record<string, unknown>).value === 'string')
        .map(option => ({ value: text(option.value, 160), label: text(option.label, 160) || text(option.value, 160) }))
      const fallback = text(item.defaultValue, 160)
      if (!options.some(option => option.value === fallback)) continue
      result.push({ key: item.key, type: 'select', label, defaultValue: fallback, options })
    }
  }
  return result
}
