import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GameModeState } from '../types/ipc'

const h = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }))
vi.mock('react', () => ({ useEffect: (effect: () => (() => void) | undefined) => { h.cleanup = effect() } }))
import { useGameModeStore } from '../stores/game-mode'
import { useGameModeSync } from './useGameModeSync'

beforeEach(() => useGameModeStore.setState({ enabled: false }))
afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals() })

it('订阅先于初始拉取，迟到初值不能覆盖托盘的新模式', async () => {
  let resolve!: (state: GameModeState) => void
  let notify!: (state: GameModeState) => void
  const off = vi.fn()
  vi.stubGlobal('window', { desktop: {
    onGameModeChange: (callback: typeof notify) => { notify = callback; return off },
    getGameMode: () => new Promise<GameModeState>(done => { resolve = done })
  } })
  useGameModeSync()
  notify({ enabled: true })
  resolve({ enabled: false })
  await Promise.resolve()
  expect(useGameModeStore.getState()).toMatchObject({ enabled: true })
  h.cleanup?.()
  expect(off).toHaveBeenCalledOnce()
})

it('卸载后丢弃初始查询结果', async () => {
  let resolve!: (state: GameModeState) => void
  vi.stubGlobal('window', { desktop: {
    onGameModeChange: () => vi.fn(),
    getGameMode: () => new Promise<GameModeState>(done => { resolve = done })
  } })
  useGameModeSync()
  h.cleanup?.()
  resolve({ enabled: true })
  await Promise.resolve()
  expect(useGameModeStore.getState().enabled).toBe(false)
})
