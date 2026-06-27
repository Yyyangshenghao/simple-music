import type { RouteHandler, ServerContext } from '../types'
import { sendJson } from '../lib/http'
import { getCookie } from '../lib/cookie'
import {
  UA,
  call,
  asObj,
  asArr,
  asStr,
  asNum,
  mapArtists,
  mapPodcastRadio,
  getLoginInfo,
  type LoginInfo,
  type MappedPodcastRadio,
} from '../lib/netease-client'
import { analyzeBeatmap } from '../lib/beatmap-stub'

// ---------- 播客数据映射 ----------
function mapPodcastProgram(program: unknown, fallbackRadio: unknown): Record<string, unknown> {
  const p = asObj(program)
  const mainSong = asObj(p.mainSong || p.song || p.mainTrack)
  const radio = asObj(p.radio || fallbackRadio)
  const mappedRadio = mapPodcastRadio(radio)
  const artists = mapArtists(mainSong.ar || mainSong.artists)
  const album = asObj(mainSong.al || mainSong.album)
  const dj = asObj(p.dj || radio.dj)
  const playableId = mainSong.id || p.mainSongId || p.songId
  return {
    type: 'podcast',
    source: 'podcast',
    id: playableId,
    programId: p.id || p.programId,
    radioId: mappedRadio.id,
    name: asStr(p.name || mainSong.name),
    artist:
      mappedRadio.name ||
      asStr(dj.nickname) ||
      artists.map((a) => a.name).join(' / ') ||
      mappedRadio.djName ||
      '',
    artists,
    artistId: artists[0] && artists[0].id,
    album: mappedRadio.name || asStr(album.name) || 'Podcast',
    cover: asStr(p.coverUrl || p.cover || p.blurCoverUrl) || mappedRadio.cover || asStr(album.picUrl),
    duration: asNum(p.duration || mainSong.dt || mainSong.duration),
    fee: mainSong.fee,
    djName: mappedRadio.djName || asStr(dj.nickname),
    radioName: mappedRadio.name,
    desc: asStr(p.description || p.desc),
    createTime: asNum(p.createTime),
    serialNum: asNum(p.serialNum || p.serial),
  }
}

function firstArrayFrom(obj: unknown, keys: string[]): unknown[] {
  const o = asObj(obj)
  for (const key of keys) {
    const value = o[key]
    if (Array.isArray(value)) return value
    const v = asObj(value)
    if (Array.isArray(v.list)) return v.list
    if (Array.isArray(v.data)) return v.data
    if (Array.isArray(v.resources)) return v.resources
  }
  return []
}

function mapPodcastVoice(voice: unknown): Record<string, unknown> {
  const v = asObj(voice)
  const raw = asObj(v.resource || v.voice || v.data || v.program || v)
  const mainSong = asObj(raw.mainSong || raw.song || raw.track)
  const radio = asObj(raw.radio || raw.djRadio || raw.voiceList || raw.podcast)
  const playableId = raw.trackId || raw.songId || raw.mainSongId || mainSong.id || raw.id
  return {
    type: 'podcast',
    source: 'podcast',
    sourceType: 'podcast-voice',
    id: playableId,
    programId: raw.programId || raw.voiceId || raw.id,
    radioId: radio.id || radio.radioId || radio.voiceListId || raw.radioId || raw.voiceListId,
    name: asStr(raw.name || raw.songName || raw.title || mainSong.name),
    artist: asStr(radio.name || radio.radioName || radio.voiceListName || raw.podcastName || raw.djName) || 'Voice',
    album: asStr(radio.name || radio.radioName || raw.podcastName) || 'Podcast',
    cover: asStr(
      raw.coverUrl || raw.cover || raw.picUrl || raw.coverImgUrl || radio.picUrl || radio.coverUrl
    ),
    duration: asNum(raw.duration || raw.durationMs || mainSong.dt || mainSong.duration),
    djName: asStr(raw.djName || asObj(radio.dj).nickname),
    radioName: asStr(radio.name || radio.radioName || raw.podcastName),
    desc: asStr(raw.desc || raw.description),
  }
}

interface PodcastCollectionRadio extends MappedPodcastRadio {
  type: string
  sourceType: string
  collectionKey: string
  radioId: unknown
  artist: string
  album: string
}
function mapPodcastCollectionRadio(r: unknown, key: string): PodcastCollectionRadio {
  const radio = mapPodcastRadio(r)
  return {
    ...radio,
    type: 'podcast-radio',
    sourceType: 'podcast-radio',
    collectionKey: key || '',
    radioId: radio.id,
    name: radio.name,
    artist: radio.djName || radio.category || 'Podcast',
    album: radio.category || 'Podcast',
  }
}

function podcastCollectionMeta(key: string, items: unknown[]): Record<string, unknown> {
  const meta =
    (
      {
        collect: { key: 'collect', title: '收藏播客', sub: '你收藏的播客', itemType: 'radio' },
        created: { key: 'created', title: '创建播客', sub: '你创建的播客', itemType: 'radio' },
        liked: { key: 'liked', title: '喜欢的声音', sub: '收藏或最近喜欢的声音', itemType: 'voice' },
      } as Record<string, Record<string, string>>
    )[key] || { key, title: key, sub: '', itemType: 'radio' }
  const first = asObj((items || [])[0])
  return {
    ...meta,
    count: (items || []).length,
    cover: asStr(first.cover || first.picUrl || first.coverUrl),
  }
}

interface MyPodcastResult {
  itemType: string
  items: unknown[]
}
async function fetchMyPodcastItems(
  key: string,
  info: LoginInfo,
  limitInput: number,
  offsetInput: number,
  cookie: string
): Promise<MyPodcastResult> {
  const limit = Math.max(8, Math.min(60, Number(limitInput) || 30))
  const offset = Math.max(0, Number(offsetInput) || 0)
  if (key === 'collect') {
    const r = await call('dj_sublist', { limit, offset, cookie, timestamp: Date.now() })
    const raw = firstArrayFrom(r.body, ['djRadios', 'djradios', 'radios', 'data'])
    return { itemType: 'radio', items: raw.map((x) => mapPodcastCollectionRadio(x, key)).filter((x) => x.id) }
  }
  if (key === 'created') {
    const r = await call('user_audio', { uid: info.userId, cookie, timestamp: Date.now() })
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios'])
    return { itemType: 'radio', items: raw.map((x) => mapPodcastCollectionRadio(x, key)).filter((x) => x.id) }
  }
  if (key === 'paid') {
    const r = await call('dj_paygift', { limit, offset, cookie, timestamp: Date.now() })
    const raw = firstArrayFrom(r.body, ['data', 'djRadios', 'djradios', 'radios'])
    return { itemType: 'radio', items: raw.map((x) => mapPodcastCollectionRadio(x, key)).filter((x) => x.id) }
  }
  if (key === 'liked') {
    let raw: unknown[] = []
    try {
      const sati = await call('sati_resource_sub_list', { cookie, timestamp: Date.now() })
      raw = firstArrayFrom(sati.body, ['data', 'resources', 'list'])
    } catch (e) {
      console.warn('[MyPodcastLiked] sati sub list failed:', (e as Error).message)
    }
    if (!raw.length) {
      try {
        const recent = await call('record_recent_voice', { limit, cookie, timestamp: Date.now() })
        raw = firstArrayFrom(recent.body, ['data', 'list', 'resources'])
      } catch (e) {
        console.warn('[MyPodcastLiked] recent voice fallback failed:', (e as Error).message)
      }
    }
    return { itemType: 'voice', items: raw.map(mapPodcastVoice).filter((x) => x.id && x.name) }
  }
  return { itemType: 'radio', items: [] }
}

export const podcastRoutes: RouteHandler = async (req, res, url, ctx: ServerContext) => {
  const pn = url.pathname
  const cookie = getCookie(ctx, 'netease')

  // ---------- 播客搜索 ----------
  if (pn === '/api/podcast/search') {
    try {
      const kw = String(url.searchParams.get('keywords') || '').trim()
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18))
      if (!kw) {
        sendJson(res, { podcasts: [] })
        return true
      }
      const r = await call('cloudsearch', { keywords: kw, type: 1009, limit, cookie, timestamp: Date.now() })
      const result = asObj(asObj(r.body).result)
      const raw = result.djRadios || result.djradios || result.radios
      const podcasts = asArr(raw).map(mapPodcastRadio).filter((p) => p.id)
      sendJson(res, { podcasts, total: asNum(result.djRadiosCount || result.djradiosCount) || podcasts.length })
    } catch (err) {
      console.error('[PodcastSearch]', err)
      sendJson(res, { error: (err as Error).message, podcasts: [] }, 500)
    }
    return true
  }

  // ---------- 热门播客 ----------
  if (pn === '/api/podcast/hot') {
    try {
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18))
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
      const r = await call('dj_hot', { limit, offset, cookie, timestamp: Date.now() })
      const body = asObj(r.body)
      const raw = body.djRadios || body.djradios || body.radios || body.data
      const podcasts = asArr(raw).map(mapPodcastRadio).filter((p) => p.id)
      sendJson(res, { podcasts, more: !!body.hasMore })
    } catch (err) {
      console.error('[PodcastHot]', err)
      sendJson(res, { error: (err as Error).message, podcasts: [] }, 500)
    }
    return true
  }

  // ---------- 播客详情 ----------
  if (pn === '/api/podcast/detail') {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid')
      if (!rid) {
        sendJson(res, { error: 'Missing podcast id' }, 400)
        return true
      }
      const r = await call('dj_detail', { rid, cookie, timestamp: Date.now() })
      const body = asObj(r.body)
      const radio = mapPodcastRadio(body.data || body.djRadio || body.radio || body)
      sendJson(res, { podcast: radio })
    } catch (err) {
      console.error('[PodcastDetail]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 播客节目列表 ----------
  if (pn === '/api/podcast/programs') {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid')
      if (!rid) {
        sendJson(res, { error: 'Missing podcast id', programs: [] }, 400)
        return true
      }
      const limit = Math.max(10, Math.min(60, parseInt(url.searchParams.get('limit') || '30', 10) || 30))
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
      const r = await call('dj_program', { rid, limit, offset, asc: false, cookie, timestamp: Date.now() })
      const body = asObj(r.body)
      const data = asObj(body.data)
      const programsRaw = Array.isArray(body.programs)
        ? body.programs
        : Array.isArray(data.list)
          ? data.list
          : asArr(data.programs)
      const first = asObj(programsRaw[0])
      const radio = first.radio ? mapPodcastRadio(first.radio) : { id: rid, rid }
      const programs = programsRaw
        .map((p) => mapPodcastProgram(p, radio))
        .filter((p) => p.id && p.name)
      sendJson(res, { radio, programs, more: !!body.more, total: asNum(body.count) || programs.length })
    } catch (err) {
      console.error('[PodcastPrograms]', err)
      sendJson(res, { error: (err as Error).message, programs: [] }, 500)
    }
    return true
  }

  // ---------- 我的播客 ----------
  if (pn === '/api/podcast/my') {
    try {
      const info = await getLoginInfo(ctx)
      if (!info.loggedIn || !info.userId) {
        const empty = ['collect', 'created', 'liked'].map((k) => podcastCollectionMeta(k, []))
        sendJson(res, { loggedIn: false, collections: empty })
        return true
      }
      const keys = ['collect', 'created', 'liked']
      const collections = await Promise.all(
        keys.map(async (key) => {
          try {
            const data = await fetchMyPodcastItems(key, info, 12, 0, cookie)
            return podcastCollectionMeta(key, data.items || [])
          } catch (e) {
            console.warn('[MyPodcast]', key, (e as Error).message)
            return podcastCollectionMeta(key, [])
          }
        })
      )
      sendJson(res, { loggedIn: true, collections })
    } catch (err) {
      console.error('[MyPodcast]', err)
      sendJson(res, { error: (err as Error).message, collections: [] }, 500)
    }
    return true
  }

  // ---------- 我的播客分项 ----------
  if (pn === '/api/podcast/my/items') {
    try {
      const info = await getLoginInfo(ctx)
      if (!info.loggedIn || !info.userId) {
        sendJson(res, { loggedIn: false, items: [] })
        return true
      }
      const key = String(url.searchParams.get('key') || 'collect')
      const limit = parseInt(url.searchParams.get('limit') || '36', 10) || 36
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0
      const data = await fetchMyPodcastItems(key, info, limit, offset, cookie)
      sendJson(res, {
        loggedIn: true,
        key,
        ...podcastCollectionMeta(key, data.items || []),
        itemType: data.itemType,
        items: data.items || [],
      })
    } catch (err) {
      console.error('[MyPodcastItems]', err)
      sendJson(res, { error: (err as Error).message, items: [] }, 500)
    }
    return true
  }

  // ---------- 播客 DJ 长音频后端离线锁拍 ----------
  if (pn === '/api/podcast/dj-beatmap') {
    try {
      const audioUrl = url.searchParams.get('url')
      const durationSec = Math.max(0, Number(url.searchParams.get('duration') || 0) || 0)
      if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
        sendJson(res, { error: 'Invalid audio url' }, 400)
        return true
      }
      console.log('[PodcastDjBeatmap] start', Math.round(durationSec || 0) + 's')
      const started = Date.now()
      const introSec = Math.max(0, Number(url.searchParams.get('intro') || 0) || 0)
      // DJ 节拍分析占位：真实算法将在后续接入 dj-analyzer。
      const map = await analyzeBeatmap(audioUrl, { durationSec, introSec, userAgent: UA })
      console.log('[PodcastDjBeatmap] done ms:', Date.now() - started)
      sendJson(res, { ok: true, map })
    } catch (err) {
      console.error('[PodcastDjBeatmap]', err)
      sendJson(res, { ok: false, error: (err as Error).message || String(err) }, 500)
    }
    return true
  }

  return false
}
