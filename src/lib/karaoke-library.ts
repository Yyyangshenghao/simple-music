import { api } from './api'
import type { Track } from '../types/domain'
import type { Accompaniment, KaraokeModelId } from '../types/karaoke'
import { sameKaraokeTrack } from '../types/karaoke'

/**
 * 只匹配同平台的原曲身份；同名歌曲和不同录音不能共用伴奏。
 * 最近播放过的版本优先；都没播放过时按所选模型、再按最近生成。
 */
export function findAccompaniment(track: Track, items: Accompaniment[], preferredModel: KaraokeModelId, played: Record<string, number> = {}): Accompaniment | null {
  const matches = accompanimentsForTrack(track, items).filter(item => item.available)
  matches.sort((a, b) => (played[b.id] ?? 0) - (played[a.id] ?? 0)
    || Number(b.model === preferredModel) - Number(a.model === preferredModel) || b.generatedAt - a.generatedAt)
  return matches[0] ?? null
}

export function accompanimentsForTrack(track: Track, items: Accompaniment[]): Accompaniment[] {
  const original = accompanimentOriginal(track) ?? track
  if (original.source === 'apple') return []
  return items.filter(item => sameKaraokeTrack(item.track, original))
    .sort((a, b) => b.generatedAt - a.generatedAt)
}

export function accompanimentTrack(item: Accompaniment): Track {
  const original = item.track.source === 'local' && item.track.cover
    ? { ...item.track, cover: api.url('/api/local/cover', { id: String(item.track.id) }) } : item.track
  return {
    ...original, provider: 'local', source: 'local', id: `karaoke:${item.id}`,
    type: 'song', pending: false, playable: item.available, url: undefined,
    accompanimentModel: item.model, accompanimentOriginal: original,
  }
}

export function accompanimentId(track: Pick<Track, 'source' | 'id'>): string | null {
  const id = String(track.id)
  return track.source === 'local' && /^karaoke:[a-f0-9]{40}$/.test(id) ? id.slice(8) : null
}

export function accompanimentOriginal(track: Track): Track | null {
  const original = track.accompanimentOriginal as Track | undefined
  if (!accompanimentId(track) || !original || !['netease', 'qq', 'local'].includes(original.source)
    || original.id == null || typeof original.name !== 'string' || !Array.isArray(original.artists)) return null
  return original.source === 'local' && original.cover ? { ...original, cover: api.url('/api/local/cover', { id: String(original.id) }) } : original
}
