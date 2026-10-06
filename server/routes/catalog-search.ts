import type { RouteHandler } from '../types'
import { sendJson } from '../lib/http'
import { getCookie } from '../lib/cookie'
import { asArr, asObj, asStr, asNum, call, mapAlbum, mapDiscoverPlaylist } from '../lib/netease-client'
import { qqMusicRequest } from '../lib/qq-client'

/** QQ 搜索的专辑/歌单字段与歌手详情、用户歌单字段不同，按搜索响应单独映射。 */
export async function searchQQCollections(cookie: string, keyword: string, kind: 'albums' | 'playlists') {
  if (!keyword.trim()) return []
  const module = 'music.search.SearchCgiService'
  const response = asObj(await qqMusicRequest(cookie, { [module]: {
    module, method: 'DoSearchForQQMusicDesktop',
    param: { search_type: kind === 'albums' ? 2 : 3, query: keyword.trim(), page_num: 1, num_per_page: 20 },
  } }))
  const block = asObj(response[module])
  if (!response[module] || Number(block.code || 0) !== 0) throw new Error('QQ_SEARCH_FAILED')
  const body = asObj(asObj(block.data).body)
  return asArr(asObj(body[kind === 'albums' ? 'album' : 'songlist']).list).map((raw) => {
    const item = asObj(raw)
    const album = kind === 'albums'
    return {
      provider: 'qq', source: 'qq', type: album ? 'album' : 'playlist',
      id: asStr(album ? item.albumMID : item.dissid),
      name: asStr(album ? item.albumName : item.dissname),
      cover: asStr(album ? item.albumPic : item.imgurl).replace(/^http:/, 'https:'),
      creator: asStr(album ? item.singerName : asObj(item.creator).name),
      trackCount: asNum(item.song_count), playCount: asNum(item.listennum),
      description: asStr(item.introduction),
    }
  }).filter((item) => item.id && item.name)
}

export const catalogSearchRoutes: RouteHandler = async (req, res, url, ctx) => {
  const match = /^\/api\/(netease|qq)\/search\/(albums|playlists)$/.exec(url.pathname)
  if (!match || req.method !== 'GET') return false
  const source = match[1] as 'netease' | 'qq'
  const kind = match[2] as 'albums' | 'playlists'
  const keyword = (url.searchParams.get('keywords') || '').trim()
  try {
    let items: unknown[]
    if (!keyword) items = []
    else if (source === 'qq') items = await searchQQCollections(getCookie(ctx, source), keyword, kind)
    else {
      const response = await call('cloudsearch', { keywords: keyword, type: kind === 'albums' ? 10 : 1000, limit: 20, cookie: getCookie(ctx, source) })
      const body = asObj(response.body)
      if (response.status !== 200 || (body.code !== undefined && Number(body.code) !== 200)) throw new Error('NETEASE_SEARCH_FAILED')
      items = asArr(asObj(body.result)[kind]).map((raw) => kind === 'albums'
        ? { ...mapAlbum(raw), creator: asArr(asObj(raw).artists || [asObj(raw).artist]).map((artist) => asStr(asObj(artist).name)).filter(Boolean).join(' / ') }
        : mapDiscoverPlaylist(raw)).filter((item) => item.id && item.name)
    }
    sendJson(res, { [kind]: items })
  } catch {
    sendJson(res, { error: 'SEARCH_FAILED', [kind]: [] }, 502)
  }
  return true
}
