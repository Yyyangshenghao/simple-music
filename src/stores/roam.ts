import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { useSettingsStore } from './settings'
import { isProviderParticipating } from './providers'
import { expireProviderAccount } from './provider-auth'
import {
  buildRoamTracks,
  computeDefaultSongCount,
  pickAdditionalTracks,
  pickArtistTracks,
  shuffle,
  type RoamMode,
} from '../lib/roam-selection'
import { buildRoamDescription, parseRoamDescription } from '../lib/roam-description'
import { rankArtistsByFrequency } from '../lib/artist-affinity'
import type { MusicService } from '../lib/music-service'
import type { ArtistInfo, Track } from '../types/domain'
import type { ProviderId } from '../providers/types'

/** 猜你喜欢歌手用的种子曲目池:红心歌单 + 近一周听歌排行(均可选,QQ 未实现时直接空数组)。 */
async function fetchLikedTracks(service: MusicService): Promise<Track[]> {
  if (!service.getLikedPlaylist) return []
  try {
    const pl = await service.getLikedPlaylist()
    if (!pl) return []
    const sk = await service.getPlaylistSkeleton(pl.id)
    return sk.tracks ?? []
  } catch {
    return []
  }
}

async function fetchRankingTracks(service: MusicService): Promise<Track[]> {
  if (!service.getListeningRanking) return []
  try {
    return await service.getListeningRanking()
  } catch {
    return []
  }
}

/** 猜歌手无限流的过期守卫:音源切换/clearSuggestions 时自增,异步回调落地前核对,避免旧音源结果写进新会话。 */
let suggestionsSession = 0

/** generate 的过期守卫:reset(含切音源)/重选歌手时自增;在途生成迟到落地前核对,避免拿旧音源结果冲掉新会话。 */
let generateSession = 0

/** 网易云漫游歌单水合会话；切换候选范围或重置时作废迟到响应。 */
let hydrationSession = 0

/**
 * 「漫游」歌单:
 * - QQ 音乐:纯本地 localStorage 临时歌单,仅当天有效,不回写账号(逻辑不变)。
 * - 网易云:写回账号里一个固定名为「每日漫游」的隐私歌单,本地只缓存歌单 id;
 *   归属靠简介水印(`Simple Music`)识别,是否需要重新生成靠简介里的日期判断。
 */

const STORAGE_KEY = 'simplemusic-roam-playlist'
const NETEASE_PLAYLIST_ID_KEY = 'simplemusic-roam-playlist-id-netease'
const NETEASE_PLAYLIST_NAME = '每日漫游'
/** 策展式选歌手,上限比原先「盲选自动生成」时代更宽松,但仍要防止歌单过度臃肿。 */
export const MAX_ARTISTS = 12
export const MAX_SONGS_PER_ARTIST = 30

/** 已选入的一位歌手：曲库池(懒加载一次)+ 当前已选曲目(可手动增删)+ 目标首数(驱动步进器增量填充)。 */
export interface RoamArtistEntry {
  artist: ArtistInfo
  pool: Track[]
  tracks: Track[]
  count: number
  /** 曲库池异步拉取中。 */
  loading: boolean
  /** 曲库池拉取失败(卡片上展示「加载失败/重试」,否则空曲库与失败无法区分,生成按钮静默禁用成死局)。 */
  loadFailed: boolean
}

export interface RoamPlaylist {
  date: string
  source: ProviderId | 'mixed'
  mode: RoamMode
  artists: { name: string }[]
  tracks: Track[]
}

export function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 读取本地漫游存档。混合音源和 QQ 结果都只保存在应用本地。
 * 日期过期不再丢弃——上一份漫游歌单保留可继续播放,直到用户主动「重新选择」或重新生成覆盖。
 */
function loadValidPlaylist(): RoamPlaylist | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as RoamPlaylist
    if (!data?.tracks) return null
    return data
  } catch {
    return null
  }
}

function loadCachedNeteasePlaylistId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(NETEASE_PLAYLIST_ID_KEY)
}

function saveCachedNeteasePlaylistId(id: unknown): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(NETEASE_PLAYLIST_ID_KEY, String(id))
  } catch {
    /* 超配额放弃落盘,内存态仍可用 */
  }
}

function clearCachedNeteasePlaylistId(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(NETEASE_PLAYLIST_ID_KEY)
}

/** generate 失败原因归一为用户可读文案(原先整段 catch 静默,失败对用户完全不可见)。 */
function describeGenerateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('HTTP 401')) return '网易云登录已失效,请重新登录后再试'
  if (msg === 'REQUEST_TIMEOUT') return '网络请求超时,请检查网络后重试'
  return `生成失败:${msg}`
}

interface RoamStore {
  playlist: RoamPlaylist | null
  /** 本机持久化的 QQ/混合漫游；与网易云远端恢复结果分槽保存，避免水合覆盖后丢失恢复入口。 */
  localPlaylist: RoamPlaylist | null
  entries: RoamArtistEntry[]
  mode: RoamMode
  scope: 'all' | ProviderId
  generating: boolean
  /** generate 最近一次失败原因(页面展示);成功/重试/重选歌手时清空。 */
  error: string | null
  /** 网易云真实歌单异步核实中(打开页面时可能要拉网络)。 */
  loading: boolean
  /** 网易云「每日漫游」歌单的真实 id(不存在时为 null)。仅当次会话内存态,持久化在 NETEASE_PLAYLIST_ID_KEY。 */
  neteasePlaylistId: unknown
  /** 本次挂载/音源会话是否已尝试过网易云真实歌单核实(避免重复请求)。 */
  neteaseHydrated: boolean
  /**
   * 选歌手画布确认时调用:整体替换已选歌手列表。已在 entries 里的歌手保留原有曲库池/已选曲目/首数
   * (不重新拉取,避免重开画布追加一位就把之前手动增删的曲目全冲掉);新加入的按人数摊算默认首数
   * (见 computeDefaultSongCount)异步拉曲库池。超过 MAX_ARTISTS 的部分丢弃。
   */
  confirmArtists(artists: ArtistInfo[]): void
  removeArtist(id: unknown, source?: ProviderId): void
  /** 曲库池拉取失败后重新拉取该歌手的曲库(卡片「重试」按钮)。 */
  retryArtistPool(id: unknown, source?: ProviderId): void
  /** 调整某位歌手的目标首数:调大从曲库池补(跳过已选),调小从尾部裁,不影响其他歌手。 */
  setArtistCount(id: unknown, count: number, source?: ProviderId): void
  /** 从该歌手曲库池里手动加入一首指定曲目(已存在则忽略)。 */
  addTrack(id: unknown, track: Track, source?: ProviderId): void
  /** 从该歌手已选曲目里移除一首(与 count 解耦,不会自动补位)。 */
  removeTrack(id: unknown, trackId: unknown, source?: ProviderId): void
  setMode(mode: RoamMode): void
  setScope(scope: 'all' | ProviderId): void
  generate(): Promise<void>
  reset(): void
  /** 网易云专属:核实账号里是否已有可复用的「每日漫游」真实歌单,核实结果写入 playlist/neteasePlaylistId。QQ(service 未实现相关方法)直接 no-op。 */
  ensureNeteaseHydrated(service: MusicService): Promise<void>

  /** 猜你喜欢的歌手(无限流建议列表)。 */
  suggestions: ArtistInfo[]
  suggestionsLoaded: boolean
  suggestionsLoading: boolean
  /** 首次拉取种子建议(红心+听歌排行统计出的常听歌手);已加载/加载中则 no-op。 */
  loadSuggestions(sources: ProviderId[]): Promise<void>
  /** 音源切换等场景清空建议列表,下次 loadSuggestions 会重新拉取。 */
  clearSuggestions(): void
}

export const useRoamStore = create<RoamStore>((set, get) => {
  const initialLocalPlaylist = loadValidPlaylist()
  const sameArtist = (entry: RoamArtistEntry, id: unknown, source?: ProviderId): boolean =>
    String(entry.artist.id) === String(id) && (!source || entry.artist.source === source)

  /** 拉取一位歌手的曲库池并落盘;confirmArtists 与 retryArtistPool 共用。调用方需先把对应 entry 置为 loading。 */
  function loadPool(artist: ArtistInfo) {
    if (artist.source !== 'local' && !isProviderParticipating(artist.source)) {
      const providerSource = artist.source
      set((s) => ({
        entries: s.entries.filter((entry) => !sameArtist(entry, artist.id, providerSource)),
      }))
      return
    }
    serviceFor(artist.source)
      .getArtistSongs(artist.id)
      .then((pool) => {
        set((s) => ({
          entries: s.entries.map((e) =>
            sameArtist(e, artist.id, artist.source === 'local' ? undefined : artist.source)
              ? { ...e, pool, tracks: pickArtistTracks(pool, s.mode, e.count), loading: false, loadFailed: false }
              : e
          )
        }))
      })
      .catch(() => {
        set((s) => ({
          entries: s.entries.map((e) =>
            sameArtist(e, artist.id, artist.source === 'local' ? undefined : artist.source)
              ? { ...e, loading: false, loadFailed: true }
              : e
          )
        }))
      })
  }

  return {
  playlist: initialLocalPlaylist,
  localPlaylist: initialLocalPlaylist,
  entries: [],
  mode: 'hot',
  scope: 'all',
  generating: false,
  error: null,
  loading: false,
  neteasePlaylistId: null,
  neteaseHydrated: false,
  suggestions: [],
  suggestionsLoaded: false,
  suggestionsLoading: false,

  confirmArtists(artists) {
    const capped = artists.slice(0, MAX_ARTISTS)
    const defaultCount = computeDefaultSongCount(capped.length)
    generateSession++ // 歌手名单变了,在途 generate 的结果作废
    set((s) => {
      const byId = new Map(s.entries.map((e) => [`${e.artist.source}:${String(e.artist.id)}`, e]))
      // 复用的 loadFailed entry 趁这次确认自动重试,不用用户逐张卡片点「重试」
      const failedIds = new Set(s.entries
        .filter((e) => e.loadFailed && e.pool.length === 0)
        .map((e) => `${e.artist.source}:${String(e.artist.id)}`))
      return {
        error: null,
        entries: capped.map((artist) => {
          const key = `${artist.source}:${String(artist.id)}`
          const existing = byId.get(key)
          if (existing && failedIds.has(key)) return { ...existing, loading: true, loadFailed: false }
          return existing ?? { artist, pool: [], tracks: [], count: defaultCount, loading: true, loadFailed: false }
        })
      }
    })

    for (const entry of get().entries) {
      if (!entry.loading || entry.pool.length > 0) continue // 复用已有的,跳过重新拉取
      loadPool(entry.artist)
    }
  },

  removeArtist(id, source) {
    set((s) => ({ entries: s.entries.filter((e) => !sameArtist(e, id, source)) }))
  },

  retryArtistPool(id, source) {
    const entry = get().entries.find((e) => sameArtist(e, id, source))
    if (!entry || entry.loading) return
    set((s) => ({
      entries: s.entries.map((e) => (sameArtist(e, id, source) ? { ...e, loading: true, loadFailed: false } : e))
    }))
    loadPool(entry.artist)
  },

  setArtistCount(id, rawCount, source) {
    const count = Math.max(1, Math.min(MAX_SONGS_PER_ARTIST, Math.round(rawCount)))
    set((s) => ({
      entries: s.entries.map((e) => {
        if (!sameArtist(e, id, source)) return e
        if (count <= e.tracks.length) return { ...e, count, tracks: e.tracks.slice(0, count) }
        const additional = pickAdditionalTracks(e.pool, e.tracks, s.mode, count - e.tracks.length)
        return { ...e, count, tracks: [...e.tracks, ...additional] }
      })
    }))
  },

  addTrack(id, track, source) {
    set((s) => ({
      entries: s.entries.map((e) => {
        if (!sameArtist(e, id, source)) return e
        if (e.tracks.some((t) => String(t.id) === String(track.id))) return e
        return { ...e, tracks: [...e.tracks, track] }
      })
    }))
  },

  removeTrack(id, trackId, source) {
    set((s) => ({
      entries: s.entries.map((e) =>
        sameArtist(e, id, source)
          ? { ...e, tracks: e.tracks.filter((t) => String(t.id) !== String(trackId)) }
          : e
      )
    }))
  },

  setMode(mode) {
    set({ mode })
  },

  setScope(scope) {
    generateSession++
    suggestionsSession++
    hydrationSession++
    set({
      scope,
      entries: [],
      error: null,
      loading: false,
      neteaseHydrated: false,
      suggestions: [],
      suggestionsLoaded: false,
      suggestionsLoading: false,
    })
  },

  async ensureNeteaseHydrated(service) {
    if (get().neteaseHydrated) return
    if (!isProviderParticipating('netease')) return
    if (!service.createPlaylist) return // QQ:不实现相关方法,no-op
    const session = ++hydrationSession
    set({ neteaseHydrated: true, loading: true })
    try {
      let id: unknown = loadCachedNeteasePlaylistId()
      if (!id) {
        const candidates = await service.findUserPlaylistsByName!(NETEASE_PLAYLIST_NAME)
        if (hydrationSession !== session) return
        const match = candidates.find((p) => parseRoamDescription(p.description) !== null)
        if (match) {
          id = match.id
          saveCachedNeteasePlaylistId(id)
        }
      }
      if (!id) {
        set({ loading: false })
        return // 没有可复用的,留在选歌手态,生成时会新建
      }
      const found = await service.getPlaylistWithDescription!(id)
      if (hydrationSession !== session) return
      if (!found) {
        clearCachedNeteasePlaylistId()
        set({ loading: false })
        return // 缓存的 id 查无此歌单(被删了),留在选歌手态
      }
      set({ neteasePlaylistId: id })
      const parsed = parseRoamDescription(found.playlist.description)
      if (parsed) {
        // 日期是否今天都展示这份歌单(过期的上一份仍可继续播放,直到用户重选/重新生成覆盖);
        // parsed.date 仍写入 playlist.date,仅用于页面区分「今日漫游」还是「上次漫游」文案。
        set({
          playlist: {
            date: parsed.date,
            source: 'netease',
            mode: get().mode,
            artists: parsed.artistNames.map((name) => ({ name })),
            tracks: found.tracks,
          },
          loading: false,
        })
      } else {
        set({ loading: false }) // 简介解不出来,留在选歌手态;neteasePlaylistId 已缓存,生成时复用
      }
    } catch {
      if (hydrationSession === session) set({ loading: false })
    }
  },

  async generate() {
    const { entries, mode } = get()
    if (entries.length === 0) return
    if (entries.some((entry) => entry.artist.source !== 'local' && !isProviderParticipating(entry.artist.source))) {
      set({ entries: [], generating: false, error: null })
      return
    }
    const session = generateSession
    set({ generating: true, error: null })
    const tracks = buildRoamTracks(entries.map((e) => e.tracks))
    const sources = [...new Set(tracks
      .map((track) => track.source)
      .filter((source): source is ProviderId => source !== 'local'))]
    const source: ProviderId | 'mixed' = sources.length === 1 ? sources[0] : 'mixed'
    const service = source === 'mixed' ? null : serviceFor(source)
    const artists = entries.map((e) => ({ name: e.artist.name }))
    const date = todayKey()

    if (source === 'netease' && useSettingsStore.getState().neteaseLoggedIn && service?.createPlaylist) {
      // 网易云:写回真实歌单
      try {
        let id = get().neteasePlaylistId
        let currentTrackIds: unknown[] = []
        if (id) {
          const found = await service.getPlaylistWithDescription!(id)
          if (found) {
            currentTrackIds = found.tracks.map((t) => t.id)
          } else {
            id = null // 缓存的 id 已失效(被删了)
          }
        }
        if (!id) {
          const created = await service.createPlaylist!(NETEASE_PLAYLIST_NAME, { private: true })
          id = created.id
        }
        await service.replacePlaylistTracks!(id, currentTrackIds, tracks.map((t) => t.id))
        await service.updatePlaylistDescription!(
          id,
          buildRoamDescription(date, artists.map((a) => a.name))
        )
        // 写回已成功,但期间用户切音源/重选了歌手:这份旧会话结果直接丢弃,不冲掉新会话
        if (generateSession !== session) return
        saveCachedNeteasePlaylistId(id)
        set({
          playlist: { date, source, mode, artists, tracks },
          neteasePlaylistId: id,
          generating: false,
          entries: [],
        })
      } catch (err) {
        if (generateSession !== session) return // 旧会话的失败不往新会话页面弹错误
        const raw = err instanceof Error ? err.message : String(err)
        // 401 = 服务端判定登录态已失效:同步清掉渲染层标记,顶栏/漫游页立即回到未登录态,
        // 而不是继续"界面显示已登录、写操作全部失效"的错位
        expireProviderAccount('netease', err)
        // 失败:留在选歌手态,不清 entries,方便重试;错误上页面,不再静默
        set({ generating: false, error: describeGenerateError(err) })
      }
      return
    }

    // QQ 或混合音源只写本地，不把跨平台 id 发送到任一远端。
    const playlist: RoamPlaylist = { date, source, mode, artists, tracks }
    if (generateSession !== session) return
    set({ playlist, localPlaylist: playlist, generating: false, entries: [] })
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist))
      } catch {
        /* 超配额放弃落盘,内存态仍可用 */
      }
    }
  },

  reset() {
    // generating 一并复位:生成请求卡死时切音源会触发本方法,若不清 generating,漫游页将永远卡在「生成中…」
    generateSession++ // 在途 generate 的结果作废,迟到落地时守卫会丢弃
    hydrationSession++
    set({ playlist: null, localPlaylist: null, entries: [], mode: 'hot', generating: false, error: null, loading: false, neteaseHydrated: false })
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  },

  async loadSuggestions(sources) {
    if (get().suggestionsLoaded || get().suggestionsLoading) return
    const participatingSources = sources.filter(isProviderParticipating)
    const services = participatingSources.map((source) => serviceFor(source))
    if (services.every((service) => !service.getLikedPlaylist && !service.getListeningRanking)) {
      set({ suggestionsLoaded: true })
      return
    }
    set({ suggestionsLoading: true })
    const session = ++suggestionsSession
    try {
      const seeds = await Promise.all(
        services.flatMap((service) => [fetchLikedTracks(service), fetchRankingTracks(service)])
      )
      if (suggestionsSession !== session) return
      const top = rankArtistsByFrequency(seeds, 16)
      if (top.length === 0) {
        set({ suggestionsLoaded: true, suggestionsLoading: false })
        return
      }
      const details = await Promise.all(top.map((artist) =>
        artist.source === 'local'
          ? Promise.resolve(null)
          : serviceFor(artist.source).getArtistDetail(artist.id).catch(() => null)
      ))
      if (suggestionsSession !== session) return
      const hydrated = shuffle(details.filter((a): a is ArtistInfo => !!a))
      set({ suggestions: hydrated, suggestionsLoaded: true, suggestionsLoading: false })
    } catch {
      if (suggestionsSession === session) set({ suggestionsLoaded: true, suggestionsLoading: false })
    }
  },

  clearSuggestions() {
    suggestionsSession++
    set({ suggestions: [], suggestionsLoaded: false, suggestionsLoading: false })
  }
  }
})
