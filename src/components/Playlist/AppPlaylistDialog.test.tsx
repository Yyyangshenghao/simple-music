import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddToAppPlaylistDialog } from './AppPlaylistDialog'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({ cleanups: [] as Array<() => void>, add: vi.fn(), create: vi.fn(), toast: vi.fn(), archiveError: '' }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) },
}))
vi.mock('../../stores/app-playlists', () => ({ useAppPlaylistsStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector({ items: [{ id: 'target', name: '通勤', tracks: [] }], error: h.archiveError }),
  { getState: () => ({ addTracks: h.add, create: h.create }) },
) }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))

const track: Track = { provider: 'local', source: 'local', type: 'song', id: 'local-id', name: '本地歌曲', artist: '', artists: [] }
function buttons(node: ReactNode): Array<ReactElement<{ children?: ReactNode; disabled?: boolean; onClick(): void }>> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick(): void }>(child)) return []
    return child.type === 'button' ? [child] : buttons(child.props.children)
  })
}

describe('选择应用歌单后的异步保存', () => {
  beforeEach(() => { vi.clearAllMocks(); h.archiveError = ''; h.add.mockReturnValue(1) })
  afterEach(() => { h.cleanups.splice(0).forEach(cleanup => cleanup()) })

  it('选择目标后保存同一批曲目，并在落盘成功后通知完成', async () => {
    const loadTracks = vi.fn(async () => [track])
    const onDone = vi.fn(), onClose = vi.fn()
    const tree = AddToAppPlaylistDialog({ loadTracks, onDone, onClose })
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!.props.onClick()
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(h.add).toHaveBeenCalledWith('target', [track])
    expect(onClose).toHaveBeenCalledOnce()
    expect(h.create).not.toHaveBeenCalled()
  })

  it.each(['close', 'unmount'])('%s 后展开的迟到结果不能保存', async action => {
    let finish!: (tracks: Track[]) => void
    const loadTracks = vi.fn(() => new Promise<Track[]>(resolve => { finish = resolve }))
    const onDone = vi.fn(), onClose = vi.fn()
    const tree = AddToAppPlaylistDialog({ loadTracks, onDone, onClose })
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!.props.onClick()
    if (action === 'close') tree.props.onClose()
    else h.cleanups.splice(0).forEach(cleanup => cleanup())
    finish([track])
    await Promise.resolve()
    await Promise.resolve()
    expect(h.add).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('写入失败不报成功、不清空选区且不关闭对话框', async () => {
    h.add.mockImplementation(() => { throw new Error('保存失败') })
    const onDone = vi.fn(), onClose = vi.fn()
    const tree = AddToAppPlaylistDialog({ loadTracks: async () => [track], onDone, onClose })
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!.props.onClick()
    await vi.waitFor(() => expect(h.add).toHaveBeenCalledOnce())
    expect(onDone).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
  })
})
