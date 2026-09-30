import { api } from './api'
import { parseAppleLyrics } from './apple-lyric-parser'
import type { Track } from '../types/domain'
import type { LyricsResult } from './lyrics-fetch'

export async function fetchNativeAppleLyrics(track: Track, signal?: AbortSignal): Promise<LyricsResult | null> {
  try {
    const catalogId = String(track.catalogId ?? '')
    const id = catalogId || String(track.id)
    const library = !catalogId && (track.appleLibrary === true || id.startsWith('i.'))
    const data = await api.get<{ ttml?: string }>('/api/apple-music/lyrics', { id, library: String(library) }, { signal, timeoutMs: 10000 })
    if (signal?.aborted || typeof data?.ttml !== 'string') return null
    const parsed = parseAppleLyrics(data.ttml)
    if (!parsed.main.length) return null
    return { source: 'apple', ...parsed }
  } catch { return null }
}
