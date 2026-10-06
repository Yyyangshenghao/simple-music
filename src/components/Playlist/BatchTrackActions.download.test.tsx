import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BatchTrackActions } from './BatchTrackActions'
import type { Playlist, Track } from '../../types/domain'

const h = vi.hoisted(() => ({ stateIndex: 0, resolve: vi.fn(), save: vi.fn(), confirm: vi.fn(), toast: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => {},
  useId: () => 'batch-menu',
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [h.stateIndex++ === 0 ? true : initial, vi.fn()],
}))
vi.mock('../../stores/providers', () => ({ useProviderStore: () => '' }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ addManyToQueue: vi.fn() }) } }))
vi.mock('../../lib/batch-tracks', () => ({ resolveBatchTracks: h.resolve }))
vi.mock('../../stores/offline-cache', () => ({ useOfflineCacheStore: { getState: () => ({ saveMany: h.save }) } }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))

const track: Track = { provider: 'netease', source: 'netease', type: 'track', id: 1, name: '晴天', artist: '周杰伦', artists: [] }
const album: Playlist = { provider: 'netease', source: 'netease', type: 'album', id: 2, name: '专辑', cover: '', creator: '', trackCount: 12, playCount: 0 }
type Button = ReactElement<{ children?: ReactNode; onClick(): void }>

function findDownloadButton(node: ReactNode): Button | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick(): void }>(child)) continue
    if (child.type === 'button' && renderToStaticMarkup(child).includes('下载')) return child
    const found = findDownloadButton(child.props.children)
    if (found) return found
  }
}

function downloadButton(props: Parameters<typeof BatchTrackActions>[0]) {
  const button = findDownloadButton(BatchTrackActions(props))
  expect(button).toBeDefined()
  return button!
}

describe('下载范围与确认', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    h.stateIndex = 0
    h.resolve.mockResolvedValue([track, { ...track, id: 2 }])
    h.save.mockResolvedValue(2)
    h.confirm.mockReturnValue(true)
    vi.stubGlobal('window', { confirm: h.confirm })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('更多菜单明确显示全部下载及歌曲数，确认取消后不下载', async () => {
    h.confirm.mockReturnValue(false)
    const button = downloadButton({ compact: true, tracks: [track, { ...track, id: 2 }], label: '当前歌曲搜索结果' })
    expect(renderToStaticMarkup(button)).toContain('全部下载（2 首）')
    button.props.onClick()
    await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledWith('确认下载当前歌曲搜索结果中的全部 2 首歌曲？'))
    expect(h.save).not.toHaveBeenCalled()
  })

  it('集合预估数量与实际数量不同时，用展开后的数量确认并下载同一批歌曲', async () => {
    const onDone = vi.fn()
    const button = downloadButton({ compact: true, tracks: [], collections: [album], label: '整张专辑', onDone })
    expect(renderToStaticMarkup(button)).toContain('全部下载（约 12 首）')
    button.props.onClick()
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(h.confirm).toHaveBeenCalledWith('确认下载整张专辑中的全部 2 首歌曲？')
    expect(h.save).toHaveBeenCalledWith([track, { ...track, id: 2 }], expect.any(AbortSignal))
  })

  it('下载所选集合时同样确认实际歌曲数', async () => {
    const button = downloadButton({ tracks: [], collections: [{ ...album, trackCountKnown: false }], selection: { total: 10, onSelectAll() {}, onClear() {}, onExit() {} } })
    expect(renderToStaticMarkup(button)).toContain('下载所选（曲数待确认）')
    button.props.onClick()
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledOnce())
    expect(h.confirm).toHaveBeenCalledWith('确认下载所选项目中的全部 2 首歌曲？')
  })

  it('单纯下载所选歌曲时保留直接下载', async () => {
    const button = downloadButton({ tracks: [track, { ...track, id: 2 }] })
    expect(renderToStaticMarkup(button)).toContain('下载所选（2 首）')
    button.props.onClick()
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledOnce())
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('展开后无可下载歌曲时提示用户，不显示确认或创建任务', async () => {
    h.resolve.mockResolvedValue([])
    downloadButton({ compact: true, tracks: [], collections: [album] }).props.onClick()
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('没有可下载的歌曲'))
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('展开过程中取消时不显示确认或创建任务', async () => {
    h.resolve.mockImplementation(async (_tracks, _collections, signal: AbortSignal) => {
      // 测试仅将传入信号标为取消，模拟集合解析期间退出或切换账号。
      Object.defineProperty(signal, 'aborted', { value: true })
      return [track]
    })
    downloadButton({ compact: true, tracks: [], collections: [album] }).props.onClick()
    await vi.waitFor(() => expect(h.resolve).toHaveBeenCalledOnce())
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
  })
})
