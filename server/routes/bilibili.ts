import type { RouteHandler } from '../types'
import { sendJson } from '../lib/http'
import { BilibiliRiskError, getBilibiliPlayInfo, getBilibiliVideoTrack, isBvid, parseBilibiliKeyword, searchBilibiliTracks } from '../lib/bilibili-client'

/**
 * 哔哩哔哩搜索与音频播放（只读游客接口，见 lib/bilibili-client.ts）：
 * - GET /api/bilibili/search?keywords=…：默认返回同曲匹配候选，mode=browse 保留视频原题和 UP 主
 * - GET /api/bilibili/song/url?bvid=…：DASH 音频候选 { candidates: [{ url, level, quality, br }], expiresAt }
 * - GET /api/bilibili/song/qualities?bvid=…：该视频实际可得的游客档位 { qualities: [{ level, label, br }] }
 * 音频地址交给 /api/audio 代理播放（补 Referer、经 SSRF 校验）。风控熔断时返回 503。
 */
export const bilibiliRoutes: RouteHandler = async (req, res, url) => {
  const pn = url.pathname
  if (!pn.startsWith('/api/bilibili/')) return false
  if (req.method && req.method !== 'GET') {
    sendJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405)
    return true
  }
  try {
    if (pn === '/api/bilibili/search') {
      const keyword = parseBilibiliKeyword(url.searchParams.get('keywords'))
      if (!keyword) {
        sendJson(res, { error: 'INVALID_PARAMS', songs: [] }, 400)
        return true
      }
      const mode = url.searchParams.get('mode') === 'browse' ? 'browse' : 'match'
      sendJson(res, { songs: await searchBilibiliTracks(keyword, fetch, Date.now(), mode) })
      return true
    }
    if (pn === '/api/bilibili/song/detail' || pn === '/api/bilibili/song/url' || pn === '/api/bilibili/song/qualities') {
      const bvid = url.searchParams.get('bvid')
      if (!isBvid(bvid)) {
        sendJson(res, { error: 'INVALID_PARAMS' }, 400)
        return true
      }
      if (pn === '/api/bilibili/song/detail') {
        sendJson(res, { track: await getBilibiliVideoTrack(bvid) })
        return true
      }
      const info = await getBilibiliPlayInfo(bvid)
      if (pn === '/api/bilibili/song/url') {
        sendJson(res, info)
      } else {
        const seen = new Set<string>()
        const qualities = info.candidates
          .filter((item) => !seen.has(item.level) && seen.add(item.level))
          .map((item) => ({ level: item.level, label: item.quality, br: item.br }))
        sendJson(res, { qualities })
      }
      return true
    }
    sendJson(res, { error: 'NOT_FOUND' }, 404)
  } catch (err) {
    const risk = err instanceof BilibiliRiskError
    console.warn('[Bilibili]', err instanceof Error ? err.message : err)
    sendJson(res, { error: risk ? 'BILIBILI_RATE_LIMITED' : 'UPSTREAM_FAILED', songs: [], candidates: [] }, risk ? 503 : 502)
  }
  return true
}
