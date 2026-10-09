import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginPlaybackIntent } from '../../lib/playback-intent'
import { useProviderStore } from '../../stores/providers'
import type { Playlist, Track } from '../../types/domain'
import type { ToplistEntry } from '../../lib/music-service'

interface Instance { cleanups: Array<() => void> }
const h = vi.hoisted(() => ({
  instance: null as Instance | null,
  instances: [] as Instance[],
  load: vi.fn(),
  setQueue: vi.fn(),
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  memo: (component: unknown) => component,
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => (() => void) | void) => {
    const cleanup = effect()
    if (cleanup) h.instance!.cleanups.push(cleanup)
  },
}))
vi.mock('../../hooks/useLazyPlaylist', () => ({ loadPlaylistQueue: h.load }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ setQueue: h.setQueue }) } }))
vi.mock('../../lib/toplist-cache', () => ({ getCachedToplistPreview: () => [], requestToplistPreview: vi.fn() }))

import { ToplistCard } from './ToplistCard'

function song(id: string): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: id, artist: '歌手', artists: [] }
}

function deferred() {
  let resolve!: (tracks: Track[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Track[]>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function mount(id: string) {
  const instance: Instance = { cleanups: [] }
  h.instance = instance
  h.instances.push(instance)
  const playlist: Playlist = { provider: 'netease', source: 'netease', type: 'playlist', id, name: id, cover: '', creator: '', trackCount: 1, playCount: 0 }
  const entry: ToplistEntry = { playlist, preview: [{ name: '预览', artist: '歌手' }], updateFrequency: '' }
  const component = ToplistCard as unknown as (props: { entry: ToplistEntry; onOpen(): void }) => ReactElement
  const tree = component({ entry, onOpen: vi.fn() })
  function findButton(node: ReactNode): ReactElement<{ onClick(event: { stopPropagation(): void }): Promise<void> }> | undefined {
    if (!node || typeof node !== 'object' || !('props' in node)) return
    const element = node as ReactElement<{ children?: ReactNode; 'aria-label'?: string }>
    if (element.type === 'button' && element.props['aria-label'] === `播放${id}`) return element as never
    for (const child of [element.props.children].flat(Infinity)) {
      const found = findButton(child as ReactNode)
      if (found) return found
    }
  }
  return {
    play: () => findButton(tree)!.props.onClick({ stopPropagation() {} }),
    unmount: () => instance.cleanups.splice(0).forEach(cleanup => cleanup()),
  }
}

describe('榜单异步点播意图', () => {
  afterEach(() => {
    for (const instance of h.instances.splice(0)) instance.cleanups.splice(0).forEach(cleanup => cleanup())
  })
  beforeEach(() => {
    vi.clearAllMocks()
    beginPlaybackIntent()
    useProviderStore.getState().setAccountState('netease', 'authenticated', { nickname: '原账号', avatar: '' })
    useProviderStore.getState().setEnabled('netease', true)
    h.setQueue.mockImplementation(() => { beginPlaybackIntent() })
  })

  it('先点 A 再点 B，B 先返回后 A 不覆盖 B', async () => {
    const first = deferred()
    const latest = deferred()
    h.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
    const a = mount('A').play()
    const b = mount('B').play()
    latest.resolve([song('B')])
    await b
    first.resolve([song('A')])
    await a
    expect(h.setQueue.mock.calls.map(([tracks]) => tracks.map((track: Track) => track.id))).toEqual([['B']])
  })

  it('等待时另一入口选曲，旧榜单不能覆盖新队列', async () => {
    const request = deferred()
    h.load.mockReturnValue(request.promise)
    const pending = mount('A').play()
    h.setQueue([song('new')])
    request.resolve([song('A')])
    await pending
    expect(h.setQueue).toHaveBeenCalledTimes(1)
    expect(h.setQueue).toHaveBeenCalledWith([song('new')])
  })

  it('卸载后迟到榜单不再起播', async () => {
    const request = deferred()
    h.load.mockReturnValue(request.promise)
    const card = mount('A')
    const pending = card.play()
    card.unmount()
    request.resolve([song('A')])
    await pending
    expect(h.setQueue).not.toHaveBeenCalled()
  })

  it('等待期间停用后重新启用也使旧请求失效', async () => {
    const request = deferred()
    h.load.mockReturnValue(request.promise)
    const card = mount('A')
    const pending = card.play()
    useProviderStore.getState().setEnabled('netease', false)
    useProviderStore.getState().setEnabled('netease', true)
    request.resolve([song('A')])
    await pending
    card.unmount()
    expect(h.setQueue).not.toHaveBeenCalled()
  })

  it('等待期间切换账号丢弃原账号榜单', async () => {
    const request = deferred()
    h.load.mockReturnValue(request.promise)
    const card = mount('A')
    const pending = card.play()
    useProviderStore.getState().setAccountState('netease', 'authenticated', { nickname: '新账号', avatar: '' })
    request.resolve([song('A')])
    await pending
    card.unmount()
    expect(h.setQueue).not.toHaveBeenCalled()
  })

  it('普通成功仍播放榜单，失败不更改当前队列', async () => {
    h.load.mockResolvedValueOnce([song('A')]).mockRejectedValueOnce(new Error('offline'))
    await mount('A').play()
    await mount('B').play()
    expect(h.setQueue).toHaveBeenCalledTimes(1)
    expect(h.setQueue).toHaveBeenCalledWith([song('A')], 0, 'A')
  })
})
