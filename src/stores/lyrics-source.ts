import { create } from 'zustand'
import type { Track } from '../types/domain'
import { LYRIC_ORIGINS, type LyricOrigin, type LyricSourcePreference, type LyricSourceCandidate, type RememberedLyricSource, type LyricSourceActions } from '../types/lyrics-source'
import { useToastStore } from './toast'

export const LYRICS_SOURCE_STORAGE_KEY = 'simplemusic-lyrics-source-v1'
const MAX_REMEMBERED = 1000
const preferences: readonly LyricSourcePreference[] = ['auto', 'origin', 'netease', 'qq', 'amll', 'kugou']
let handlers: LyricSourceActions | undefined

interface LyricsSourceStore extends LyricSourceActions {
  defaultSource: LyricSourcePreference
  remembered: Record<string, RememberedLyricSource>
  candidates: LyricSourceCandidate[]
  candidateTrackKey: string | null
  candidateToken: string | null
  appliedOrigin: LyricOrigin | null
  requestedOrigin: LyricOrigin | 'auto'
  fallbackReason: string | null
  appliedPreference: LyricSourcePreference
  setDefaultSource(value: LyricSourcePreference): void
  clearRemembered(): void
}

function trackKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && /^(netease|qq|apple|local):.+/u.test(value)
}
function origin(value: unknown): value is LyricOrigin {
  return LYRIC_ORIGINS.includes(value as LyricOrigin)
}
function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
}

/** 白名单拷贝，匹配引用不能夹带音频 URL、cookie 或其他平台响应字段。 */
export function lyricMatchReference(value: unknown): Track | undefined {
  if (!value || typeof value !== 'object') return undefined
  const track = value as Track
  if ((track.source !== 'netease' && track.source !== 'qq') || (typeof track.id !== 'string' && typeof track.id !== 'number')
    || typeof track.name !== 'string' || typeof track.artist !== 'string') return undefined
  const result: Track = {
    source: track.source, provider: track.source, type: 'song', id: String(track.id).slice(0, 256),
    name: track.name.slice(0, 512), artist: track.artist.slice(0, 512),
    artists: Array.isArray(track.artists) ? track.artists.slice(0, 10).filter(item => item && typeof item.name === 'string')
      .map(item => ({ id: String(item.id ?? '').slice(0, 256), name: item.name.slice(0, 256) })) : [],
  }
  if (typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0) result.duration = track.duration
  for (const key of ['mid', 'songmid', 'qqId', 'album', 'isrc', 'ISRC']) {
    if (typeof track[key] === 'string' || typeof track[key] === 'number') result[key] = String(track[key]).slice(0, 512)
  }
  return result
}

function write(defaultSource: LyricSourcePreference, remembered: Record<string, RememberedLyricSource>): boolean {
  try {
    const value = JSON.stringify({ schema: 1, defaultSource, remembered })
    localStorage.setItem(LYRICS_SOURCE_STORAGE_KEY, value)
    if (localStorage.getItem(LYRICS_SOURCE_STORAGE_KEY) !== value) return false
    return true
  } catch { return false }
}

/** 只由播放宿主启动时读取；UI 从宿主快照恢复，不能回写旧分区偏好。 */
export function loadLyricsSourcePreferences(): void {
  let defaultSource: LyricSourcePreference = 'auto'
  let remembered: Record<string, RememberedLyricSource> = {}
  try {
    const archive = JSON.parse(localStorage.getItem(LYRICS_SOURCE_STORAGE_KEY) ?? 'null')
    if (archive?.schema === 1) {
      if (preferences.includes(archive.defaultSource)) defaultSource = archive.defaultSource
      if (archive.remembered && typeof archive.remembered === 'object' && !Array.isArray(archive.remembered)) {
        remembered = Object.fromEntries(Object.entries(archive.remembered).slice(0, MAX_REMEMBERED).flatMap(([key, value]) => {
          const entry = value as RememberedLyricSource | null
          if (!trackKey(key) || !entry || !origin(entry.origin) || typeof entry.name !== 'string' || typeof entry.artist !== 'string') return []
          return [[key, { origin: entry.origin, name: entry.name.slice(0, 512), artist: entry.artist.slice(0, 512), match: lyricMatchReference(entry.match) }]]
        }))
      }
    }
  } catch { /* 旧存档不可读时沿用自动选择，不阻止播放。 */ }
  useLyricsSourceStore.setState({ defaultSource, remembered })
}

export function rememberLyricsSource(key: string, entry: RememberedLyricSource | null): boolean {
  if (!trackKey(key) || (entry && !origin(entry.origin))) return false
  const current = useLyricsSourceStore.getState()
  if (entry && !Object.hasOwn(current.remembered, key) && Object.keys(current.remembered).length >= MAX_REMEMBERED) return false
  const remembered = { ...current.remembered }
  if (entry) remembered[key] = { origin: entry.origin, name: entry.name.slice(0, 512), artist: entry.artist.slice(0, 512), match: lyricMatchReference(entry.match) }
  else delete remembered[key]
  if (!write(current.defaultSource, remembered)) return false
  useLyricsSourceStore.setState({ remembered })
  return true
}

export function bindLyricsSourceActions(actions: LyricSourceActions): () => void {
  handlers = actions
  return () => { if (handlers === actions) handlers = undefined }
}
function runtime(): LyricSourceActions {
  if (!handlers) throw new Error('歌词服务尚未就绪，请稍后重试')
  return handlers
}

export const useLyricsSourceStore = create<LyricsSourceStore>((set, get) => ({
  defaultSource: 'auto', remembered: {}, candidates: [], candidateTrackKey: null, candidateToken: null,
  appliedOrigin: null, requestedOrigin: 'auto', fallbackReason: null, appliedPreference: 'auto',
  setDefaultSource(value) {
    if (!preferences.includes(value)) throw new Error('无效的默认歌词来源')
    if (get().defaultSource === value) return
    if (!write(value, get().remembered)) { useToastStore.getState().show('无法保存默认歌词来源，请重试'); return }
    set({ defaultSource: value })
  },
  clearRemembered() {
    if (!write(get().defaultSource, {})) { useToastStore.getState().show('无法清除歌词来源选择，请重试'); return }
    set({ remembered: {} })
  },
  async queryCandidates(key, token, requested) {
    if (!trackKey(key) || !validToken(token) || (requested !== undefined && !origin(requested))) throw new Error('无效的歌词查询')
    return runtime().queryCandidates(key, token, requested)
  },
  cancelSelection(token) {
    if (!validToken(token)) throw new Error('无效的歌词选择会话')
    handlers?.cancelSelection(token)
  },
  async chooseSource(key, token, requested, remember) {
    if (!trackKey(key) || !validToken(token) || (requested !== 'auto' && !origin(requested)) || typeof remember !== 'boolean') throw new Error('无效的歌词选择')
    return runtime().chooseSource(key, token, requested, remember)
  },
}))
