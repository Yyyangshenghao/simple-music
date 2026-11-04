function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

export function bilibiliTitleText(rawTitle: string): string {
  return decodeEntities(rawTitle.replace(/<[^>]+>/g, ''))
}

/** 画质、音质、上传形式等宣传词：不属于歌名或歌手。 */
const TITLE_NOISE = [
  /\bhi-?res\b|\bdolby\b|\bflac\b|\b(?:4k|8k)\b|\b\d{3,4}p\b|\b60\s?(?:fps|帧)\b|\bhd\b|\bhq\b|\bsq\b/giu,
  /\b(?:official\s+)?(?:music\s+video|mv|pv|lyrics?\s+video|audio|video)\b/giu,
  /无损(?:音质)?|高音质|高品质|高清|超清|蓝光|音质|杜比|全景声|母带|录音棚|百万级|试听|修复版?|官方|完整版|动态歌词|歌词版?|中日字幕|中英字幕|中字|字幕/gu,
]

function cleanSegment(text: string): string {
  const cleaned = TITLE_NOISE.reduce((value, pattern) => value.replace(pattern, ' '), text)
  return cleaned
    .replace(/[“”"‘’'|｜丨·•~～!！]+/gu, ' ')
    .replace(/[\s,，、:：]+$/u, '')
    .replace(/^[\s,，、:：]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface TitleReading {
  name: string
  artists: string[]
}

/**
 * 视频标题 → 若干种「歌名 + 歌手」读法。B 站标题没有固定格式，常见写法：
 * 「【Hi-Res】《晴天》- 周杰伦」「周杰伦 - 晴天MV」「米津玄師「Lemon」」。
 * 有书名号/直角引号时只取其中的歌名；否则按分隔符拆段，每段都试作歌名，其余段与 UP 主作歌手。
 * 是否同一首交给渲染层同曲评分（标题、歌手、时长±3秒）判定，读法错了只会不匹配。
 */
export function readingsFromTitle(rawTitle: string, uploader: string): TitleReading[] {
  let title = bilibiliTitleText(rawTitle).normalize('NFKC')
  const withoutTags = title.replace(/【[^】]*】|\[[^\]]*\]/gu, ' ')
  if (withoutTags.trim()) title = withoutTags
  title = title.replace(/[“"‘'][^”"’']{6,}[”"’']/gu, ' ')
  title = TITLE_NOISE.reduce((value, pattern) => value.replace(pattern, ' '), title)
  const owner = cleanSegment(uploader)
  const quoted = /《([^》]+)》/u.exec(title) ?? /「([^」]+)」/u.exec(title) ?? /『([^』]+)』/u.exec(title)
  if (quoted) {
    const name = cleanSegment(quoted[1])
    // 歌名之外的引号多是歌词摘句，不当作歌手。
    const rest = title.replace(quoted[0], ' - ').replace(/「[^」]*」|『[^』]*』/gu, ' ')
    const artists = splitSegments(rest)
    return name ? [{ name, artists: unique([...artists, owner]) }] : []
  }
  const segments = splitSegments(title)
  if (segments.length <= 1) return segments[0] ? [{ name: segments[0], artists: unique([owner]) }] : []
  return segments.slice(0, 3).map((name, index) => ({
    name,
    artists: unique([...segments.filter((_, other) => other !== index), owner]),
  }))
}

function splitSegments(text: string): string[] {
  return text
    // 英文名里的连字符（Jay-Z）不拆；紧挨中日韩文字的 - 才当分隔符。
    .split(/\s+[-–—/]+\s+|[–—]+|\s*[|｜丨]\s*|(?<=[^\x00-\x7f])-|-(?=[^\x00-\x7f])|\s+-|-\s+/u)
    .map(cleanSegment)
    .filter((segment) => segment && [...segment].length <= 40)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
