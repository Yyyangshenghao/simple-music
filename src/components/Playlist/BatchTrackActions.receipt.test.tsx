import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BatchTrackActions } from './BatchTrackActions'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], add: vi.fn(), resolve: vi.fn(), toast: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => 'receipt-menu',
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = initial
    return [h.slots[index], (value: unknown) => { h.slots[index] = value }]
  },
  useRef: (initial: unknown) => h.slots[h.cursor++] ??= { current: initial },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = h.cursor++
    const previous = h.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) h.effects.push(() => {
      previous?.cleanup?.()
      h.slots[index] = { deps, cleanup: effect() }
    })
  },
}))
vi.mock('./PlatformPlaylistDialog', () => ({ AddToPlatformPlaylistDialog: () => null }))
vi.mock('../../lib/platform-playlists', () => ({ isWritablePlaylistSource: (source: string) => source === 'netease' || source === 'qq', supportsPlatformPlaylists: () => true }))
vi.mock('../../stores/providers', () => ({ useProviderStore: () => '' }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ addManyToQueue: h.add }) } }))
vi.mock('../../lib/batch-tracks', () => ({ resolveBatchTracks: h.resolve }))
vi.mock('../../stores/offline-cache', () => ({ useOfflineCacheStore: { getState: () => ({}) } }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))

const track: Track = { provider: 'local', source: 'local', type: 'song', id: 'one', name: '歌曲', artist: '', artists: [] }
function render(props: Parameters<typeof BatchTrackActions>[0]) {
  h.cursor = 0
  const tree = BatchTrackActions(props)
  h.effects.splice(0).forEach(effect => effect())
  return tree
}
function buttons(node: ReactNode): Array<ReactElement<{ children?: ReactNode; onClick(): void }>> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick(): void }>(child)) return []
    return child.type === 'button' ? [child] : buttons(child.props.children)
  })
}
function click(props: Parameters<typeof BatchTrackActions>[0], label: string) {
  buttons(render(props)).find(button => renderToStaticMarkup(button).includes(label))!.props.onClick()
}
function unmount() { h.slots.forEach(slot => (slot as { cleanup?: () => void } | undefined)?.cleanup?.()) }

beforeEach(() => {
  vi.clearAllMocks()
  h.slots = []; h.effects = []
  h.resolve.mockImplementation(async (tracks: Track[]) => tracks)
  h.add.mockResolvedValue(1)
})
afterEach(unmount)

describe('追加队列的异步回执', () => {
  it.each(['cancel', 'change', 'unmount'])('%s 后旧回执不能提示成功或清空选区', async action => {
    let finish!: (value: number) => void
    h.add.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve }))
    const onDone = vi.fn()
    const props = { tracks: [track], onDone }
    click(props, '添加到播放队列')
    await vi.waitFor(() => expect(h.add).toHaveBeenCalledOnce())
    if (action === 'cancel') click(props, '取消操作')
    else if (action === 'change') render({ ...props, tracks: [{ ...track, id: 'new-selection' }] })
    else unmount()
    finish(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(h.toast).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    // 已受理的追加不撤销，也不为取消重发另一条后台命令。
    expect(h.add).toHaveBeenCalledTimes(1)
  })

  it('正常回执提示追加数量并仅完成一次', async () => {
    const onDone = vi.fn()
    click({ tracks: [track], onDone }, '添加到播放队列')
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(h.toast).toHaveBeenCalledOnce()
    expect(h.toast).toHaveBeenCalledWith('已追加 1 首到播放队列')
    expect(h.add).toHaveBeenCalledWith([track], false)
  })
})
