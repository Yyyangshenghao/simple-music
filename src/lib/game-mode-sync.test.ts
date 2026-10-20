import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GameModeState } from '../types/ipc'

import { useGameModeStore } from '../stores/game-mode'
import { initGameModeSync } from './game-mode-sync'

let stopSync: (() => void) | undefined

beforeEach(() => useGameModeStore.setState({ enabled: false, initialized: false }))
afterEach(() => { stopSync?.(); vi.unstubAllGlobals() })

it('订阅先于初始拉取，迟到初值不能覆盖托盘的新模式', async () => {
  let resolve!: (state: GameModeState) => void
  let notify!: (state: GameModeState) => void
  const off = vi.fn()
  vi.stubGlobal('window', { desktop: {
    onGameModeChange: (callback: typeof notify) => { notify = callback; return off },
    getGameMode: () => new Promise<GameModeState>(done => { resolve = done })
  } })
  stopSync = initGameModeSync()
  expect(initGameModeSync()).toBe(stopSync)
  notify({ enabled: true })
  resolve({ enabled: false })
  await Promise.resolve()
  expect(useGameModeStore.getState()).toMatchObject({ enabled: true })
  stopSync()
  stopSync()
  expect(off).toHaveBeenCalledOnce()
  notify({ enabled: false })
  expect(useGameModeStore.getState().enabled).toBe(true)
})

it('宿主停止后丢弃初始查询结果', async () => {
  let resolve!: (state: GameModeState) => void
  vi.stubGlobal('window', { desktop: {
    onGameModeChange: () => vi.fn(),
    getGameMode: () => new Promise<GameModeState>(done => { resolve = done })
  } })
  stopSync = initGameModeSync()
  stopSync()
  resolve({ enabled: true })
  await Promise.resolve()
  expect(useGameModeStore.getState().enabled).toBe(false)
})
