import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { useSettingsStore } from './settings'
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
import type { ArtistInfo, MusicSource, Track } from '../types/domain'

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
}

export interface RoamPlaylist {
  date: string
  source: MusicSource
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
 * 读取 QQ 本地存档;音源与当前 activeSource 不符则返回 null。
 * 日期过期不再丢弃——上一份漫游歌单保留可继续播放,直到用户主动「重新选择」或重新生成覆盖。
 */
function loadValidPlaylist(): RoamPlaylist | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as RoamPlaylist
    if (!data?.tracks || data.source !== useSettingsStore.getState().activeSource) {
      return null
    }
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

interface RoamStore {
  playlist: RoamPlaylist | null
  entries: RoamArtistEntry[]
  mode: RoamMode
  generating: boolean
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
  removeArtist(id: unknown): void
  /** 调整某位歌手的目标首数:调大从曲库池补(跳过已选),调小从尾部裁,不影响其他歌手。 */
  setArtistCount(id: unknown, count: number): void
  /** 从该歌手曲库池里手动加入一首指定曲目(已存在则忽略)。 */
  addTrack(id: unknown, track: Track): void
  /** 从该歌手已选曲目里移除一首(与 count 解耦,不会自动补位)。 */
  removeTrack(id: unknown, trackId: unknown): void
  setMode(mode: RoamMode): void
  generate(): Promise<void>
  reset(): void
  /** 网易云专属:核实账号里是否已有可复用的「每日漫游」真实歌单,核实结果写入 playlist/neteasePlaylistId。QQ(service 未实现相关方法)直接 no-op。 */
  ensureNeteaseHydrated(service: MusicService): Promise<void>

  /** 猜你喜欢的歌手(无限流建议列表)。 */
  suggestions: ArtistInfo[]
  suggestionsLoaded: boolean
  suggestionsLoading: boolean
  /** 首次拉取种子建议(红心+听歌排行统计出的常听歌手);已加载/加载中则 no-op。 */
  loadSuggestions(service: MusicService): Promise<void>
  /** 音源切换等场景清空建议列表,下次 loadSuggestions 会重新拉取。 */
  clearSuggestions(): void
}

export const useRoamStore = create<RoamStore>((set, get) => ({
  playlist: loadValidPlaylist(),
  entries: [],
  mode: 'hot',
  generating: false,
  loading: false,
  neteasePlaylistId: null,
  neteaseHydrated: false,
  suggestions: [],
  suggestionsLoaded: false,
  suggestionsLoading: false,

  confirmArtists(artists) {
    const capped = artists.slice(0, MAX_ARTISTS)
    const defaultCount = computeDefaultSongCount(capped.length)
    set((s) => {
      const byId = new Map(s.entries.map((e) => [String(e.artist.id), e]))
      return {
        entries: capped.map(
          (artist) => byId.get(String(artist.id)) ?? { artist, pool: [], tracks: [], count: defaultCount, loading: true }
        )
      }
    })

    for (const entry of get().entries) {
      if (!entry.loading || entry.pool.length > 0) continue // 复用已有的,跳过重新拉取
      const artist = entry.artist
      serviceFor(artist.source)
        .getArtistSongs(artist.id)
        .then((pool) => {
          set((s) => ({
            entries: s.entries.map((e) =>
              String(e.artist.id) === String(artist.id)
                ? { ...e, pool, tracks: pickArtistTracks(pool, s.mode, e.count), loading: false }
                : e
            )
          }))
        })
        .catch(() => {
          set((s) => ({
            entries: s.entries.map((e) => (String(e.artist.id) === String(artist.id) ? { ...e, loading: false } : e))
          }))
        })
    }
  },

  removeArtist(id) {
    set((s) => ({ entries: s.entries.filter((e) => String(e.artist.id) !== String(id)) }))
  },

  setArtistCount(id, rawCount) {
    const count = Math.max(1, Math.min(MAX_SONGS_PER_ARTIST, Math.round(rawCount)))
    set((s) => ({
      entries: s.entries.map((e) => {
        if (String(e.artist.id) !== String(id)) return e
        if (count <= e.tracks.length) return { ...e, count, tracks: e.tracks.slice(0, count) }
        const additional = pickAdditionalTracks(e.pool, e.tracks, s.mode, count - e.tracks.length)
        return { ...e, count, tracks: [...e.tracks, ...additional] }
      })
    }))
  },

  addTrack(id, track) {
    set((s) => ({
      entries: s.entries.map((e) => {
        if (String(e.artist.id) !== String(id)) return e
        if (e.tracks.some((t) => String(t.id) === String(track.id))) return e
        return { ...e, tracks: [...e.tracks, track] }
      })
    }))
  },

  removeTrack(id, trackId) {
    set((s) => ({
      entries: s.entries.map((e) =>
        String(e.artist.id) === String(id) ? { ...e, tracks: e.tracks.filter((t) => String(t.id) !== String(trackId)) } : e
      )
    }))
  },

  setMode(mode) {
    set({ mode })
  },

  async ensureNeteaseHydrated(service) {
    if (get().neteaseHydrated) return
    if (!service.createPlaylist) return // QQ:不实现相关方法,no-op
    set({ neteaseHydrated: true, loading: true })
    try {
      let id: unknown = loadCachedNeteasePlaylistId()
      if (!id) {
        const candidates = await service.findUserPlaylistsByName!(NETEASE_PLAYLIST_NAME)
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
      set({ loading: false })
    }
  },

  async generate() {
    const { entries, mode } = get()
    if (entries.length === 0) return
    set({ generating: true })
    const source = useSettingsStore.getState().activeSource
    const service = serviceFor(source)
    const tracks = buildRoamTracks(entries.map((e) => e.tracks))
    const artists = entries.map((e) => ({ name: e.artist.name }))
    const date = todayKey()

    if (service.createPlaylist) {
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
        saveCachedNeteasePlaylistId(id)
        set({
          playlist: { date, source, mode, artists, tracks },
          neteasePlaylistId: id,
          generating: false,
          entries: [],
        })
      } catch {
        set({ generating: false }) // 失败:留在选歌手态,不清 entries,方便重试
      }
      return
    }

    // QQ / 本地路径,逻辑不变
    const playlist: RoamPlaylist = { date, source, mode, artists, tracks }
    set({ playlist, generating: false, entries: [] })
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist))
      } catch {
        /* 超配额放弃落盘,内存态仍可用 */
      }
    }
  },

  reset() {
    set({ playlist: null, entries: [], mode: 'hot', loading: false, neteaseHydrated: false })
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  },

  async loadSuggestions(service) {
    if (get().suggestionsLoaded || get().suggestionsLoading) return
    if (!service.getLikedPlaylist && !service.getListeningRanking) {
      set({ suggestionsLoaded: true })
      return
    }
    set({ suggestionsLoading: true })
    const session = ++suggestionsSession
    try {
      const [liked, ranking] = await Promise.all([fetchLikedTracks(service), fetchRankingTracks(service)])
      if (suggestionsSession !== session) return
      const top = rankArtistsByFrequency([liked, ranking], 16)
      if (top.length === 0) {
        set({ suggestionsLoaded: true, suggestionsLoading: false })
        return
      }
      const details = await Promise.all(top.map((a) => service.getArtistDetail(a.id).catch(() => null)))
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
}))
