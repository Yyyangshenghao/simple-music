import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ tracks: [] as Track[], preload: vi.fn(), release: vi.fn(), cleanups: [] as Array<() => void> }))
vi.mock('react', () => ({ useEffect: (effect: () => (() => void) | void) => {
  const cleanup = effect()
  if (cleanup) h.cleanups.push(cleanup)
} }))
vi.mock('../stores/shuange', () => ({
  SHUANGE_COVER_PX: 768,
  useShuangeStore: (select: (state: { preloadWindow: Track[] }) => unknown) => select({ preloadWindow: h.tracks }),
}))
vi.mock('../lib/track-preload', () => ({ preloadTracks: h.preload, releasePreloadWindow: h.release }))
import { useShuangeCoverPreload } from './useShuangeCoverPreload'

beforeEach(() => { vi.clearAllMocks(); h.tracks = [{ id: 1, source: 'netease', cover: 'https://cover/1' } as Track] })
afterEach(() => { h.cleanups.splice(0).forEach(cleanup => cleanup()) })

it('可见界面消费宿主窗口 只预热卡片同尺寸封面', () => {
  useShuangeCoverPreload(true)
  expect(h.preload).toHaveBeenCalledWith(h.tracks, 'standard', null, { owner: 'shuange', coverPx: 768, deferUrls: true })
})

it('隐藏或游戏模式释放图片窗口 恢复后使用最新位置', () => {
  useShuangeCoverPreload(false)
  expect(h.preload).not.toHaveBeenCalled()
  expect(h.release).toHaveBeenCalledWith('shuange')
  h.tracks = [{ id: 2, source: 'netease' } as Track]
  useShuangeCoverPreload(true)
  expect(h.preload.mock.lastCall?.[0]).toBe(h.tracks)
})
