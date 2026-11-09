import type { ReactElement, ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
}))
vi.mock('../../hooks/useMotion', () => ({ useMotion: () => true, useFeedback: () => <T,>(value: T) => value }))
vi.mock('../../hooks/useContentProvider', () => ({ useContentProvider: () => ({ current: null }) }))
vi.mock('../../stores/settings', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  const store = original.useSettingsStore
  return { ...original, useSettingsStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})
vi.mock('../../stores/providers', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/providers')>()
  const store = original.useProviderStore
  return { ...original, useProviderStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})
vi.mock('../../stores/navigation', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/navigation')>()
  const store = original.useNavigationStore
  return { ...original, useNavigationStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) }
})
import { TopBar } from './TopBar'
import { useNavigationStore } from '../../stores/navigation'

interface NodeProps { children?: ReactNode; 'aria-label'?: string; onClick?(event?: unknown): void }
function walk(node: ReactNode): ReactElement<NodeProps>[] {
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<NodeProps>
  return [element, ...[element.props.children].flat(Infinity).flatMap(child => walk(child as ReactNode))]
}

afterEach(() => vi.unstubAllGlobals())

it.each([['后退', 'goBack'], ['前进', 'goForward']] as const)('%s按钮不把点击事件送到后台导航', (label, action) => {
  vi.stubGlobal('window', {})
  const previous = useNavigationStore.getState()
  const command = vi.fn((...args: unknown[]) => { structuredClone(args) })
  useNavigationStore.setState({ [action]: command, history: ['explore'], future: ['library'] })
  try {
    const button = walk(TopBar({})).find(element => element.props['aria-label'] === label)!
    expect(() => button.props.onClick!({ type: 'click', preventDefault() {} })).not.toThrow()
    expect(command.mock.calls).toEqual([[]])
  } finally { useNavigationStore.setState(previous, true) }
})
