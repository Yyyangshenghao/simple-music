import { expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

vi.mock('../stores/player', () => ({ usePlayerStore: vi.fn() }))
vi.mock('../stores/playlist', () => ({ usePlaylistStore: vi.fn() }))
vi.mock('../stores/settings', () => ({ useSettingsStore: vi.fn() }))
vi.mock('../lib/track-preload', () => ({ preloadTracks: vi.fn(), releasePreloadWindow: vi.fn() }))
import { lyricsCoverNeighbors } from './useLyricsCoverPreload'

const t = (id: number) => ({ id, source: 'netease', cover: `https://p1.music.126.net/${id}.jpg` }) as Track
const queue = [t(0), t(1), t(2), t(3)]

it('顺序播放预热前后两首', () => {
  expect(lyricsCoverNeighbors({ queue, queueIndex: 0, shuffleOrder: [0, 1, 2, 3] }, 'order', null)).toEqual([queue[1], queue[3]])
})

it('随机播放按洗牌走序取邻居', () => {
  expect(lyricsCoverNeighbors({ queue, queueIndex: 1, shuffleOrder: [2, 1, 3, 0] }, 'shuffle', null)).toEqual([queue[3], queue[2]])
})

it('洗牌序失效、刷歌上下文或单曲队列不预热邻居', () => {
  expect(lyricsCoverNeighbors({ queue, queueIndex: 1, shuffleOrder: [] }, 'shuffle', null)).toEqual([])
  expect(lyricsCoverNeighbors({ queue, queueIndex: 1, shuffleOrder: [0, 1, 2, 3] }, 'order', 'shuange:1')).toEqual([])
  expect(lyricsCoverNeighbors({ queue: [t(0)], queueIndex: 0, shuffleOrder: [0] }, 'order', null)).toEqual([])
})

it('两首队列前后是同一首时去重', () => {
  const pair = [t(0), t(1)]
  expect(lyricsCoverNeighbors({ queue: pair, queueIndex: 0, shuffleOrder: [0, 1] }, 'order', null)).toEqual([pair[1]])
})
