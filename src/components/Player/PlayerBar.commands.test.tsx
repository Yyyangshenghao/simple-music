import { Children, isValidElement, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { PlayerBar } from './PlayerBar'
import { usePlayerStore } from '../../stores/player'
import { usePlaylistStore } from '../../stores/playlist'

vi.mock('../../stores/player', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/player')>()
  const store = original.usePlayerStore
  return { ...original, usePlayerStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})
vi.mock('../../stores/playlist', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/playlist')>()
  const store = original.usePlaylistStore
  return { ...original, usePlaylistStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})

const player = usePlayerStore.getState()
const playlist = usePlaylistStore.getState()
afterEach(() => {
  usePlayerStore.setState(player, true)
  usePlaylistStore.setState(playlist, true)
})

function buttonHandler(node: ReactNode, label: string): ((event: unknown) => void) | undefined {
  let handler: ((event: unknown) => void) | undefined
  Children.forEach(node, child => {
    if (!isValidElement<{ children?: ReactNode; 'aria-label'?: string; onClick?: (event: unknown) => void }>(child)) return
    if (child.props['aria-label'] === label) handler = child.props.onClick
    handler ??= buttonHandler(child.props.children, label)
  })
  return handler
}

it.each(['播放', '上一首', '下一首'])('%s按钮不把React事件传入后台命令', label => {
  // 模拟IPC的结构化克隆边界；事件中的函数不能发送到播放宿主。
  const command = vi.fn((...args: unknown[]) => { structuredClone(args) })
  usePlayerStore.setState({ status: 'paused', toggle: command })
  usePlaylistStore.setState({ prev: command, next: command })
  const click = buttonHandler(PlayerBar({}), label)
  expect(click).toBeTypeOf('function')
  expect(() => click!({ type: 'click', preventDefault() {} })).not.toThrow()
  expect(command.mock.calls).toEqual([[]])
})
