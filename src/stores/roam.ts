import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { useSettingsStore } from './settings'
import { buildRoamTracks, pickArtistTracks, type RoamMode } from '../lib/roam-selection'
import { buildRoamDescription, parseRoamDescription } from '../lib/roam-description'
import type { MusicService } from '../lib/music-service'
import type { ArtistInfo, MusicSource, Track } from '../types/domain'

/**
 * 「漫游」歌单:
 * - QQ 音乐:纯本地 localStorage 临时歌单,仅当天有效,不回写账号(逻辑不变)。
 * - 网易云:写回账号里一个固定名为「每日漫游」的隐私歌单,本地只缓存歌单 id;
 *   归属靠简介水印(`Simple Music`)识别,是否需要重新生成靠简介里的日期判断。
 */

const STORAGE_KEY = 'simplemusic-roam-playlist'
const NETEASE_PLAYLIST_ID_KEY = 'simplemusic-roam-playlist-id-netease'
const NETEASE_PLAYLIST_NAME = '每日漫游'
export const MAX_ARTISTS = 5

export interface RoamPlaylist {
  date: string
  source: MusicSource
  mode: RoamMode
  artists: { name: string }[]
  tracks: Track[]
}

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取 QQ 本地存档;日期不是今天或音源与当前 activeSource 不符则视为过期,返回 null。 */
function loadValidPlaylist(): RoamPlaylist | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as RoamPlaylist
    if (!data?.tracks || data.date !== todayKey() || data.source !== useSettingsStore.getState().activeSource) {
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
  selectedArtists: ArtistInfo[]
  mode: RoamMode
  generating: boolean
  /** 网易云真实歌单异步核实中(打开页面时可能要拉网络)。 */
  loading: boolean
  /** 网易云「每日漫游」歌单的真实 id(不存在时为 null)。仅当次会话内存态,持久化在 NETEASE_PLAYLIST_ID_KEY。 */
  neteasePlaylistId: unknown
  /** 本次挂载/音源会话是否已尝试过网易云真实歌单核实(避免重复请求)。 */
  neteaseHydrated: boolean
  addArtist(artist: ArtistInfo): void
  removeArtist(id: unknown): void
  setMode(mode: RoamMode): void
  generate(): Promise<void>
  reset(): void
  /** 网易云专属:核实账号里是否已有可复用的「每日漫游」真实歌单,核实结果写入 playlist/neteasePlaylistId。QQ(service 未实现相关方法)直接 no-op。 */
  ensureNeteaseHydrated(service: MusicService): Promise<void>
}

export const useRoamStore = create<RoamStore>((set, get) => ({
  playlist: loadValidPlaylist(),
  selectedArtists: [],
  mode: 'hot',
  generating: false,
  loading: false,
  neteasePlaylistId: null,
  neteaseHydrated: false,

  addArtist(artist) {
    const { selectedArtists } = get()
    if (selectedArtists.length >= MAX_ARTISTS) return
    if (selectedArtists.some((a) => String(a.id) === String(artist.id))) return
    set({ selectedArtists: [...selectedArtists, artist] })
  },

  removeArtist(id) {
    set((s) => ({ selectedArtists: s.selectedArtists.filter((a) => String(a.id) !== String(id)) }))
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
      if (parsed && parsed.date === todayKey()) {
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
        set({ loading: false }) // 简介过期/解不出来,留在选歌手态;neteasePlaylistId 已缓存,生成时复用
      }
    } catch {
      set({ loading: false })
    }
  },

  async generate() {
    const { selectedArtists, mode } = get()
    if (selectedArtists.length === 0) return
    set({ generating: true })
    const source = useSettingsStore.getState().activeSource
    const service = serviceFor(source)
    const picks = await Promise.all(
      selectedArtists.map(async (artist) => {
        try {
          const pool = await service.getArtistSongs(artist.id)
          return pickArtistTracks(pool, mode)
        } catch {
          return []
        }
      })
    )
    const tracks = buildRoamTracks(picks)
    const artists = selectedArtists.map((a) => ({ name: a.name }))
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
          selectedArtists: [],
        })
      } catch {
        set({ generating: false }) // 失败:留在选歌手态,不清 selectedArtists,方便重试
      }
      return
    }

    // QQ / 本地路径,逻辑不变
    const playlist: RoamPlaylist = { date, source, mode, artists, tracks }
    set({ playlist, generating: false, selectedArtists: [] })
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist))
      } catch {
        /* 超配额放弃落盘,内存态仍可用 */
      }
    }
  },

  reset() {
    set({ playlist: null, selectedArtists: [], mode: 'hot', loading: false, neteaseHydrated: false })
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  }
}))
