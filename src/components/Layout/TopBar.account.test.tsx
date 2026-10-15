import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], search: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = typeof initial === 'function' ? initial() : initial
    return [h.slots[index], (next: unknown) => { h.slots[index] = typeof next === 'function' ? next(h.slots[index]) : next }]
  },
  useRef: (initial: unknown) => h.slots[h.cursor++] ??= { current: initial },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = h.cursor++
    const previous = h.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) h.effects.push(() => {
      previous?.cleanup?.()
      h.slots[index] = { deps, cleanup: effect() }
    })
  },
}))
vi.mock('../../hooks/useContentProvider', () => ({ useContentProvider: () => ({ current: 'netease' }) }))
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
vi.mock('../../providers/registry', async importOriginal => {
  const original = await importOriginal<typeof import('../../providers/registry')>()
  return { ...original, providerFor: (source: Parameters<typeof original.providerFor>[0]) => {
    const provider = original.providerFor(source)
    return { ...provider, catalog: { ...provider.catalog, searchTracks: h.search, searchArtists: async () => [] } }
  } }
})
import { TopBar } from './TopBar'
import { useProviderStore } from '../../stores/providers'
import { useNavigationStore } from '../../stores/navigation'

function render() {
  h.cursor = 0
  const tree = TopBar({})
  h.effects.splice(0).forEach(effect => effect())
  return tree
}
interface NodeProps { children?: ReactNode; role?: string; 'aria-label'?: string; onClick?(event?: unknown): void; onFocus?(): void; onChange?(event: { target: { value: string } }): void }
function walk(node: ReactNode): ReactElement<NodeProps>[] {
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<{ children?: ReactNode }>
  return [element, ...[element.props.children].flat(Infinity).flatMap(child => walk(child as ReactNode))]
}
function content(tree: ReactNode): string { return walk(tree).map(element => typeof element.props.children === 'string' ? element.props.children : '').join(' ') }
const track = (name: string): Track => ({ id: name, source: 'netease', provider: 'netease', type: 'song', name, artist: '', artists: [] })
function startSearch() {
  walk(render()).find(element => element.props.role === 'search')!.props.onClick!()
  const input = walk(render()).find(element => element.type === 'input')!
  input.props.onFocus!()
  input.props.onChange!({ target: { value: '同一关键词' } })
  render()
}
beforeEach(() => {
  vi.useFakeTimers()
  h.slots = []; h.effects = []; h.search.mockReset()
  vi.stubGlobal('window', {})
  useProviderStore.setState({ byId: {
    netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: false, auth: 'anonymous' }, apple: { enabled: false, auth: 'anonymous' },
  } })
})
afterEach(() => {
  for (const slot of h.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.()
  vi.useRealTimers(); vi.unstubAllGlobals()
})
it.each([['后退', 'goBack'], ['前进', 'goForward']] as const)('%s按钮不把点击事件送到后台导航', (label, action) => {
  const previous = useNavigationStore.getState()
  const command = vi.fn((...args: unknown[]) => { structuredClone(args) })
  useNavigationStore.setState({ [action]: command, history: ['explore'], future: ['library'] })
  try {
    const button = walk(render()).find(element => element.props['aria-label'] === label)!
    expect(() => button.props.onClick!({ type: 'click', preventDefault() {} })).not.toThrow()
    expect(command.mock.calls).toEqual([[]])
  } finally { useNavigationStore.setState(previous, true) }
})
it('同平台换号立即清除旧搜索建议，并用原关键词读取新账号', async () => {
  h.search.mockResolvedValueOnce([track('旧账号结果')]).mockResolvedValueOnce([track('新账号结果')])
  startSearch()
  await vi.advanceTimersByTimeAsync(250)
  expect(content(render())).toContain('旧账号结果')
  useProviderStore.getState().setAccountState('netease', 'authenticated')
  render()
  expect(content(render())).not.toContain('旧账号结果')
  expect(h.search).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(250)
  expect(h.search).toHaveBeenNthCalledWith(2, '同一关键词')
  expect(content(render())).toContain('新账号结果')
})
it('换号后旧搜索在途结果被丢弃，重新查询可结束加载', async () => {
  let resolve!: (tracks: Track[]) => void
  h.search.mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValueOnce([track('当前账号结果')])
  startSearch()
  await vi.advanceTimersByTimeAsync(250)
  useProviderStore.getState().setAccountState('netease', 'authenticated')
  render()
  resolve([track('迟到旧结果')])
  await vi.advanceTimersByTimeAsync(250)
  expect(h.search).toHaveBeenCalledTimes(2)
  expect(content(render())).toContain('当前账号结果')
  expect(content(render())).not.toContain('迟到旧结果')
})

it('未参与平台的账号变化不重查当前平台，也不清除有效搜索建议', async () => {
  h.search.mockResolvedValue([track('当前平台结果')])
  startSearch()
  await vi.advanceTimersByTimeAsync(250)
  useProviderStore.getState().setAccountState('qq', 'authenticated')
  render()
  await vi.advanceTimersByTimeAsync(250)
  expect(h.search).toHaveBeenCalledTimes(1)
  expect(content(render())).toContain('当前平台结果')
})
