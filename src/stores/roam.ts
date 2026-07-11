import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { useSettingsStore } from './settings'
import { buildRoamTracks, pickArtistTracks, type RoamMode } from '../lib/roam-selection'
import type { ArtistInfo, MusicSource, Track } from '../types/domain'

/** 本地临时混播歌单:仅当天有效,只存本地,不回写网易云/QQ 音乐账号。 */

const STORAGE_KEY = 'simplemusic-roam-playlist'
export const MAX_ARTISTS = 5

export interface RoamPlaylist {
  date: string
  source: MusicSource
  mode: RoamMode
  artists: ArtistInfo[]
  tracks: Track[]
}

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取本地存档;日期不是今天或音源与当前 activeSource 不符则视为过期,返回 null。 */
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

interface RoamStore {
  playlist: RoamPlaylist | null
  selectedArtists: ArtistInfo[]
  mode: RoamMode
  generating: boolean
  addArtist(artist: ArtistInfo): void
  removeArtist(id: unknown): void
  setMode(mode: RoamMode): void
  generate(): Promise<void>
  reset(): void
}

export const useRoamStore = create<RoamStore>((set, get) => ({
  playlist: loadValidPlaylist(),
  selectedArtists: [],
  mode: 'hot',
  generating: false,

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
    const playlist: RoamPlaylist = { date: todayKey(), source, mode, artists: selectedArtists, tracks }
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
    set({ playlist: null, selectedArtists: [], mode: 'hot' })
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  }
}))
