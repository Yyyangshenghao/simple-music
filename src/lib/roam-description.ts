/** 「每日漫游」歌单简介的构造与解析:水印 + 日期 + 歌手名单,三段用 ' · ' 分隔,用于识别歌单归属与判断是否需要重新生成。 */

const WATERMARK = 'Simple Music'
const SEPARATOR = ' · '

export interface ParsedRoamDescription {
  date: string
  artistNames: string[]
}

export function buildRoamDescription(date: string, artistNames: string[]): string {
  return [WATERMARK, date, artistNames.join('/')].join(SEPARATOR)
}

export function parseRoamDescription(description: string | undefined): ParsedRoamDescription | null {
  if (!description || !description.includes(WATERMARK)) return null
  const parts = description.split(SEPARATOR)
  if (parts.length < 3) return null
  const date = parts[1]?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const artistNames = (parts[2] ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  return { date, artistNames }
}
