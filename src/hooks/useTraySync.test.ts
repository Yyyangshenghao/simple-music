import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }))
vi.mock('react', () => ({ useEffect: (effect: () => (() => void) | undefined) => { h.cleanup = effect() } }))
vi.mock('../stores/player', async () => {
  const { create } = await import('zustand')
  return { usePlayerStore: create(() => ({ currentTrack: null, status: 'idle', volume: 0.5, position: 0 })) }
})
vi.mock('../stores/playlist', async () => {
  const { create } = await import('zustand')
  return { usePlaylistStore: create(() => ({ queue: [] })) }
})
import { usePlayerStore } from '../stores/player'
import { useVisualStore } from '../stores/visual'
import { useTraySync } from './useTraySync'

afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals() })

it('后台托盘只同步控制状态，高频播放进度不产生推送，卸载释放订阅', () => {
  const update = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('window', { desktop: { updateTrayPlayback: update } })
  useTraySync()
  expect(update).toHaveBeenCalledOnce()
  for (let position = 1; position <= 100; position++) usePlayerStore.setState({ position })
  expect(update).toHaveBeenCalledOnce()
  usePlayerStore.setState({ status: 'playing' })
  usePlayerStore.setState({ volume: 0.7 })
  const visual = useVisualStore.getState().fx
  useVisualStore.setState({ fx: { ...visual, desktopLyrics: !visual.desktopLyrics } })
  expect(update).toHaveBeenCalledTimes(4)
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ volume: 0.7, playing: true }))
  h.cleanup?.()
  usePlayerStore.setState({ volume: 0.8 })
  expect(update).toHaveBeenCalledTimes(4)
  useVisualStore.setState({ fx: visual })
})
