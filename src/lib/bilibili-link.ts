export type BilibiliLinkReason = 'short-link' | 'multipart' | 'invalid-link'

export type BilibiliLink =
  | { kind: 'video'; bvid: string }
  | { kind: 'unsupported'; reason: BilibiliLinkReason }

export function bilibiliLinkMessage(reason: BilibiliLinkReason): string {
  if (reason === 'short-link') return '请打开分享链接后复制完整的视频链接，或直接输入 BV 号。'
  if (reason === 'multipart') return '暂不支持指定分 P，请使用视频第一页链接或 BV 号。'
  return '未能识别视频链接，请输入完整的哔哩哔哩视频链接或 BV 号。'
}

const VIDEO_ID = /^BV[0-9A-Za-z]{10}$/i
const VIDEO_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'])

/** 只提取已知站点中的 BV 身份，不访问用户粘贴的 URL。普通搜索词返回 null。 */
export function parseBilibiliLink(input: string): BilibiliLink | null {
  const text = input.trim()
  if (VIDEO_ID.test(text)) return { kind: 'video', bvid: `BV${text.slice(2)}` }
  const urls = text.match(/https?:\/\/[^\s<>"'，。！？、（）【】]+/giu) ?? []
  const firstUrl = urls[0]
  if (firstUrl) {
    if (urls.length > 1) return { kind: 'unsupported', reason: 'invalid-link' }
    const raw = firstUrl.replace(/[),;!]+$/, '')
    let url: URL
    try { url = new URL(raw) } catch { return { kind: 'unsupported', reason: 'invalid-link' } }
    if (url.hostname === 'b23.tv' || url.hostname === 'www.b23.tv') {
      return { kind: 'unsupported', reason: 'short-link' }
    }
    if (!VIDEO_HOSTS.has(url.hostname)) {
      return /bilibili|b23\.tv|\/BV[0-9A-Za-z]/i.test(raw) ? { kind: 'unsupported', reason: 'invalid-link' } : null
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || raw.includes('\\')) {
      return { kind: 'unsupported', reason: 'invalid-link' }
    }
    const match = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/i.exec(url.pathname)
    if (!match) return { kind: 'unsupported', reason: 'invalid-link' }
    const parts = [...url.searchParams.getAll('p'), ...new URLSearchParams(url.hash.slice(1)).getAll('p')]
    if (parts.some(part => /^\d+$/.test(part) && Number(part) > 1)) return { kind: 'unsupported', reason: 'multipart' }
    if (parts.some(part => part !== '1') || parts.length > 1) return { kind: 'unsupported', reason: 'invalid-link' }
    return { kind: 'video', bvid: `BV${match[1].slice(2)}` }
  }
  if (/bilibili\.com\/video\/|b23\.tv\//i.test(text)) return { kind: 'unsupported', reason: 'invalid-link' }
  const ids = [...text.matchAll(/(?:^|[^0-9A-Za-z])(BV[0-9A-Za-z]{10})(?![0-9A-Za-z])/gi)]
  if (ids.length === 1) return { kind: 'video', bvid: `BV${ids[0][1].slice(2)}` }
  if (ids.length > 1 || /^BV[0-9A-Za-z]+$/i.test(text)) return { kind: 'unsupported', reason: 'invalid-link' }
  return null
}
