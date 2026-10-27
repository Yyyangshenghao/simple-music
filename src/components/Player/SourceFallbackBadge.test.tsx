import { beforeEach, expect, it, vi } from 'vitest'
import { SourceFallbackBadge } from './SourceFallbackBadge'
import type { MusicSource, Track } from '../../types/domain'

const h = vi.hoisted(() => ({
  player: { actualSource: 'local' as MusicSource, currentTrack: null as Track | null, accompaniment: null as Track | null },
  mode: 'dynamic',
}))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: typeof h.player) => unknown) => select(h.player) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (select: (state: { sourceBadgeMode: string }) => unknown) => select({ sourceBadgeMode: h.mode }) }))
vi.mock('../../hooks/useMotion', () => ({ usePageTransition: () => (value: unknown) => value }))
const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: '歌曲', artist: '艺人', artists: [] }
beforeEach(() => { h.mode = 'dynamic'; h.player = { currentTrack: track, actualSource: 'local', accompaniment: null } })

it.each(['dynamic', 'always'])('伴奏模式不因%s来源设置额外显示本地标识', mode => {
  h.mode = mode
  h.player.accompaniment = { ...track, source: 'local', id: `karaoke:${'a'.repeat(40)}` }
  expect(SourceFallbackBadge().props.children).toBe(false)
})

it('直接播放我的伴奏时也不显示本地标识', () => {
  h.mode = 'always'
  h.player.currentTrack = { ...track, source: 'local', id: `karaoke:${'a'.repeat(40)}` }
  expect(SourceFallbackBadge().props.children).toBe(false)
})

it('普通本地音乐的常显标识和在线换源标识保持可见', () => {
  h.mode = 'always'; h.player.currentTrack = { ...track, source: 'local' }
  expect(SourceFallbackBadge().props.children).toBeTruthy()
  h.mode = 'dynamic'; h.player.currentTrack = track; h.player.actualSource = 'qq'
  expect(SourceFallbackBadge().props.children).toBeTruthy()
})
