import { create } from 'zustand'
import { usePlayerStore } from './player'
import { useSettingsStore } from './settings'
import type { TrackMatchResult } from '../lib/track-match'
import type { Track } from '../types/domain'
import { bilibiliIdentityKey, rankBilibiliSongCandidates, selectBilibiliSongMatch } from '../lib/bilibili-song-match'

/** 哔哩哔哩视频 → 已核验的曲库身份与专辑封面；兼容旧版纯封面条目。 */
const STORAGE_KEY = 'simplemusic-bilibili-covers'
const MAX_ENTRIES = 600
const MISS_TTL_MS = 24 * 60 * 60 * 1000
const IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface CoverEntry { cover: string; at: number; match?: Track; identityKey?: string }

const keyOf = (track: Track) => `bilibili:${String(track.id)}`

function readEntries(): Record<string, CoverEntry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const now = Date.now()
    return trimEntries(Object.fromEntries(Object.entries(parsed as Record<string, CoverEntry>).filter(([, entry]) =>
      entry && typeof entry.cover === 'string' && typeof entry.at === 'number' && (entry.cover || entry.match || now - entry.at < MISS_TTL_MS))))
  } catch {
    return {}
  }
}

function writeEntries(entries: Record<string, CoverEntry>): void {
  try {
    const list = Object.entries(entries).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(list)))
  } catch { /* 存储不可用时只保留本次会话 */ }
}

interface BilibiliCoverStore {
  entries: Record<string, CoverEntry>
  remember(track: Track, cover: string): void
  rememberIdentity(track: Track, match: Track, confirmed?: boolean): void
  querySongCandidates(track: Track, refresh?: boolean): Promise<TrackMatchResult[]>
  confirmSongCandidate(track: Track, candidate: Track): Promise<void>
  /** 只识别当前播放项；列表只复用已有结果。 */
  request(track: Track): void
}

let active: { key: string; videoKey: string; controller: AbortController } | undefined
const attempts = new Map<string, number>()
let observers = 0

function requestContext(track: Track): string {
  return bilibiliIdentityKey(track)
}

function trimEntries(entries: Record<string, CoverEntry>): Record<string, CoverEntry> {
  return Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES))
}

export const useBilibiliCoverStore = create<BilibiliCoverStore>((set, get) => ({
  entries: typeof localStorage === 'undefined' ? {} : readEntries(),
  remember(track, cover) {
    if (track?.source !== 'bilibili' || typeof cover !== 'string') return
    const entries = trimEntries({ ...get().entries, [keyOf(track)]: { ...get().entries[keyOf(track)], cover, at: Date.now() } })
    set({ entries })
    writeEntries(entries)
  },
  rememberIdentity(track, match, confirmed = false) {
    if (track?.source !== 'bilibili' || !(confirmed ? rankBilibiliSongCandidates(track, [match]).length : selectBilibiliSongMatch(track, [match]))) return
    // 只持久化曲库元数据，不保留临时音频 URL 或平台响应里的其他字段。
    const snapshot: Track = {
      provider: match.provider, source: match.source, type: match.type, id: match.id,
      name: match.name, artist: match.artist, artists: match.artists,
      duration: match.duration, album: match.album, cover: match.cover,
      ...(confirmed ? { bilibiliIdentityConfirmed: true } : {}),
    }
    for (const field of ['mid', 'songmid', 'qqId', 'catalogId', 'isrc', 'ISRC']) {
      if (typeof match[field] === 'string' || typeof match[field] === 'number') snapshot[field] = match[field]
    }
    const entries = trimEntries({ ...get().entries, [keyOf(track)]: {
      cover: match.cover ?? '', at: Date.now(), match: snapshot, identityKey: bilibiliIdentityKey(track),
    } })
    set({ entries })
    writeEntries(entries)
  },
  async querySongCandidates(track, refresh = false) {
    const current = usePlayerStore.getState().currentTrack
    if (!current || current.source !== 'bilibili' || bilibiliIdentityKey(current) !== bilibiliIdentityKey(track)) throw new Error('播放曲目已变化')
    const key = requestContext(current)
    const controller = new AbortController()
    const stop = usePlayerStore.subscribe(state => {
      if (!state.currentTrack || state.currentTrack.source !== 'bilibili' || requestContext(state.currentTrack) !== key) controller.abort()
    })
    try {
      const { getBilibiliSongCandidates } = await import('../lib/bilibili-song-identity')
      const result = await getBilibiliSongCandidates(current, controller.signal, refresh)
      const playing = usePlayerStore.getState().currentTrack
      if (controller.signal.aborted || !playing || playing.source !== 'bilibili' || requestContext(playing) !== key) throw new Error('播放曲目已变化')
      return result
    } finally { stop() }
  },
  async confirmSongCandidate(track, candidate) {
    const { confirmBilibiliSongCandidate } = await import('../lib/bilibili-song-identity')
    const current = usePlayerStore.getState().currentTrack
    if (!current || current.source !== 'bilibili' || bilibiliIdentityKey(current) !== bilibiliIdentityKey(track)) throw new Error('播放曲目已变化')
    confirmBilibiliSongCandidate(current, candidate)
  },
  request(track) {
    if (track?.source !== 'bilibili') return
    const playing = usePlayerStore.getState().currentTrack
    if (!playing || playing.source !== 'bilibili' || bilibiliIdentityKey(playing) !== bilibiliIdentityKey(track)) return
    const key = requestContext(track)
    if (active?.key === key || matchedBilibiliTrack(track) || (attempts.get(key) ?? 0) > Date.now()) return
    active?.controller.abort()
    if (active) attempts.delete(active.key)
    attempts.set(key, Date.now() + 60_000)
    while (attempts.size > MAX_ENTRIES) attempts.delete(attempts.keys().next().value!)
    const request = { key, videoKey: bilibiliIdentityKey(track), controller: new AbortController() }
    active = request
    void import('../lib/bilibili-song-identity').then(({ resolveBilibiliSongIdentity }) =>
      resolveBilibiliSongIdentity(track, request.controller.signal))
      .catch(() => { /* 失败不保存，稍后可重试。 */ })
      .finally(() => { if (active === request) active = undefined })
  },
}))

/** 规范歌曲身份只在原题、时长、简介均未改变且结果仍有效时复用。 */
export function matchedBilibiliTrack(track: Track | null | undefined, entries = useBilibiliCoverStore.getState().entries): Track | undefined {
  if (track?.source !== 'bilibili') return undefined
  const entry = entries[keyOf(track)]
  return entry?.match && entry.identityKey === bilibiliIdentityKey(track) && Date.now() - entry.at < IDENTITY_TTL_MS
    ? entry.match : undefined
}

/** 当前播放项需要显示时触发身份识别，与封面开关分离；列表展示不会触发搜索。 */
export function requestBilibiliCover(track: Track | null | undefined): void {
  if (active && (!track || active.videoKey !== bilibiliIdentityKey(track))) {
    active.controller.abort()
    attempts.delete(active.key)
    active = undefined
  }
  if (track?.source !== 'bilibili' || matchedBilibiliTrack(track)) return
  void Promise.resolve(useBilibiliCoverStore.getState().request(track)).catch(() => {})
}

/** 用已加载的平台结果补封面（如聚合搜索），省去额外搜索；只接受通过歌词级同曲校验的候选。 */
export async function seedBilibiliCovers(tracks: Track[], catalogTracks: Track[]): Promise<void> {
  if (!catalogTracks.length || !tracks.some(track => track.source === 'bilibili')) return
  for (const track of tracks) {
    if (track.source !== 'bilibili' || matchedBilibiliTrack(track)) continue
    const best = selectBilibiliSongMatch(track, catalogTracks)
    if (best) await useBilibiliCoverStore.getState().rememberIdentity(track, best.track)
  }
}

/** 当前应展示的封面：开关开启且已匹配到专辑封面时用专辑封面，否则用曲目自带封面。 */
export function trackCoverOf(track: Track | null | undefined, entries = useBilibiliCoverStore.getState().entries, enabled = useSettingsStore.getState().bilibiliAlbumCover): string | undefined {
  if (!track) return undefined
  const own = typeof track.cover === 'string' && track.cover ? track.cover : undefined
  if (track.source !== 'bilibili' || !enabled) return own
  const entry = entries[keyOf(track)]
  if (entry?.identityKey && !matchedBilibiliTrack(track, entries)) return own
  return entry?.cover || own
}

/** 订阅当前曲目展示封面的变化（换曲、开关切换或封面匹配完成），供非 React 同步模块使用。 */
export function subscribeCurrentTrackCover(listener: () => void): () => void {
  observers++
  let previous = trackCoverOf(usePlayerStore.getState().currentTrack)
  const check = () => {
    const track = usePlayerStore.getState().currentTrack
    requestBilibiliCover(track)
    const next = trackCoverOf(track)
    if (next === previous) return
    previous = next
    listener()
  }
  check()
  const stops = [usePlayerStore.subscribe(check), useBilibiliCoverStore.subscribe(check), useSettingsStore.subscribe(check)]
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    stops.forEach(stop => stop())
    if (--observers === 0) requestBilibiliCover(null)
  }
}
