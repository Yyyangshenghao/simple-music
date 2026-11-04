import { create } from 'zustand'
import { usePlayerStore } from './player'
import { useSettingsStore } from './settings'
import type { Track } from '../types/domain'

/** 哔哩哔哩曲目 → 同曲专辑封面。空串表示已查过但没有可靠同曲。 */
const STORAGE_KEY = 'simplemusic-bilibili-covers'
const MAX_ENTRIES = 600
const MISS_TTL_MS = 24 * 60 * 60 * 1000
const CONCURRENCY = 2
const COVER_SOURCES = ['netease', 'qq'] as const

interface CoverEntry { cover: string; at: number }

const keyOf = (track: Track) => `bilibili:${String(track.id)}`

function readEntries(): Record<string, CoverEntry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const now = Date.now()
    return Object.fromEntries(Object.entries(parsed as Record<string, CoverEntry>).filter(([, entry]) =>
      entry && typeof entry.cover === 'string' && typeof entry.at === 'number' && (entry.cover || now - entry.at < MISS_TTL_MS)))
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
  /** 排队查询专辑封面；主窗口经播放宿主转发，由宿主统一查询与存档。 */
  request(track: Track): void
}

const inFlight = new Set<string>()
const queue: Track[] = []
let running = 0

export const useBilibiliCoverStore = create<BilibiliCoverStore>((set, get) => ({
  entries: typeof localStorage === 'undefined' ? {} : readEntries(),
  remember(track, cover) {
    if (track?.source !== 'bilibili' || typeof cover !== 'string') return
    const entries = { ...get().entries, [keyOf(track)]: { cover, at: Date.now() } }
    set({ entries })
    writeEntries(entries)
  },
  request(track) {
    if (track?.source !== 'bilibili') return
    const key = keyOf(track)
    if (inFlight.has(key) || get().entries[key]) return
    inFlight.add(key)
    queue.push(track)
    pump()
  },
}))

// 匹配链路依赖较重，按需加载，避免同步模块（媒体键、迷你播放器）连带引入整个歌词管线。
const matchModules = () => Promise.all([import('../lib/lyrics-fetch'), import('../lib/lyric-service'), import('../lib/track-match')])

async function resolveCover(track: Track): Promise<string | null> {
  const [{ findLyricMatch }, { lyricServiceMode }] = await matchModules()
  let searched = false
  for (const source of COVER_SOURCES) {
    if (!lyricServiceMode(source)) continue
    searched = true
    const match = await findLyricMatch(track, source)
    const cover = match?.track.cover
    if (typeof cover === 'string' && cover) return cover
  }
  // 没有可查询的平台（例如登录状态尚未确认）时不写负缓存，之后再试。
  return searched ? '' : null
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const track = queue.shift()!
    const key = keyOf(track)
    running += 1
    void resolveCover(track)
      .then(cover => { if (cover !== null) useBilibiliCoverStore.getState().remember(track, cover) })
      .catch(() => { /* 网络失败不缓存，下次展示时重试 */ })
      .finally(() => {
        running -= 1
        inFlight.delete(key)
        pump()
      })
  }
}

/** 本窗口已请求过的曲目，避免列表重渲染时反复跨窗口转发。 */
const asked = new Set<string>()

/** 列表或播放需要显示时调用；已缓存、已请求或开关关闭时不做任何事。 */
export function requestBilibiliCover(track: Track | null | undefined): void {
  if (track?.source !== 'bilibili' || !useSettingsStore.getState().bilibiliAlbumCover) return
  const key = keyOf(track)
  const entry = useBilibiliCoverStore.getState().entries[key]
  if (entry || asked.has(key)) return
  asked.add(key)
  // 失败或暂不可查时宿主不写缓存；稍后允许本窗口再请求一次。
  setTimeout(() => asked.delete(key), 60_000)
  const { pending: _pending, url: _url, ...plain } = track
  void Promise.resolve(useBilibiliCoverStore.getState().request(plain as Track)).catch(() => {})
}

/** 用已加载的平台结果补封面（如聚合搜索），省去额外搜索；只接受通过歌词级同曲校验的候选。 */
export async function seedBilibiliCovers(tracks: Track[], catalogTracks: Track[]): Promise<void> {
  const candidates = catalogTracks.filter(item => typeof item.cover === 'string' && item.cover)
  if (!candidates.length || !tracks.some(track => track.source === 'bilibili')) return
  const [{ isLyricMatch }, , { scoreTrackMatch }] = await matchModules()
  const { entries, remember } = useBilibiliCoverStore.getState()
  for (const track of tracks) {
    if (track.source !== 'bilibili' || entries[keyOf(track)]?.cover) continue
    const best = candidates
      .filter(candidate => isLyricMatch(track, candidate))
      .map(candidate => ({ candidate, score: scoreTrackMatch(track, candidate) ?? 0 }))
      .sort((a, b) => b.score - a.score)[0]
    if (best) void Promise.resolve(remember(track, best.candidate.cover as string)).catch(() => {})
  }
}

/** 当前应展示的封面：开关开启且已匹配到专辑封面时用专辑封面，否则用曲目自带封面。 */
export function trackCoverOf(track: Track | null | undefined, entries = useBilibiliCoverStore.getState().entries, enabled = useSettingsStore.getState().bilibiliAlbumCover): string | undefined {
  if (!track) return undefined
  const own = typeof track.cover === 'string' && track.cover ? track.cover : undefined
  if (track.source !== 'bilibili' || !enabled) return own
  return entries[keyOf(track)]?.cover || own
}

/** 订阅当前曲目展示封面的变化（换曲、开关切换或封面匹配完成），供非 React 同步模块使用。 */
export function subscribeCurrentTrackCover(listener: () => void): () => void {
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
  return () => stops.forEach(stop => stop())
}
