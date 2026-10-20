import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformPlaylistNameDialog, PlatformPlaylistPicker } from './PlatformPlaylistDialog'
import type { Playlist, Track } from '../../types/domain'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], session: 0, signature: 'original', inspect: vi.fn(), mutate: vi.fn(), list: vi.fn(), toast: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => ':stable-create-request:',
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = initial
    return [h.slots[index], (value: unknown) => { h.slots[index] = typeof value === 'function' ? value(h.slots[index]) : value }]
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
vi.mock('../../stores/providers', () => ({ useProviderStore: () => h.signature }))
vi.mock('../../lib/provider-account-session', () => ({ providerAccountSession: () => h.session }))
vi.mock('../../providers/registry', () => ({ providerFor: () => ({ library: { getUserPlaylists: h.list } }) }))
vi.mock('../../lib/platform-playlists', () => ({ inspectPlatformPlaylist: h.inspect, mutatePlatformPlaylist: h.mutate, platformPlaylistResultMessage: (result: { status: string }) => result.status === 'complete' ? '平台操作完成' : '请刷新歌单查看结果' }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))

const track: Track = { source: 'netease', provider: 'netease', type: 'song', id: 1, name: '晴天', artist: '', artists: [], playable: false }
const playlist: Playlist = { source: 'netease', provider: 'netease', type: 'playlist', id: '2', name: '通勤', cover: '', trackCount: 0, playCount: 0, creator: '' }
type ElementProps = { children?: ReactNode; onClick?(): void; onSubmit?(event: { preventDefault(): void }): void; onChange?(event: { target: { value: string } }): void; disabled?: boolean }
function elements(node: ReactNode, tag: string): Array<ReactElement<ElementProps>> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<ElementProps>(child)) return []
    return child.type === tag ? [child] : elements(child.props.children, tag)
  })
}
function render<T>(component: (props: T) => ReactElement, props: T) {
  h.cursor = 0
  const tree = component(props)
  h.effects.splice(0).forEach(effect => effect())
  return tree
}
function click(tree: ReactElement, text: string) {
  const button = elements(tree.props.children, 'button').find(item => renderToStaticMarkup(item).includes(text))
  expect(button, text).toBeTruthy()
  button!.props.onClick?.()
}
async function listed() {
  await vi.waitFor(() => expect(h.list).toHaveBeenCalledOnce())
  await Promise.resolve(); await Promise.resolve()
}
function unmount() { h.slots.forEach(slot => (slot as { cleanup?: () => void } | undefined)?.cleanup?.()) }
function fillAndSubmit(props: Parameters<typeof PlatformPlaylistNameDialog>[0], name = '新歌单') {
  let tree = render(PlatformPlaylistNameDialog, props)
  elements(tree.props.children, 'input')[0].props.onChange!({ target: { value: name } })
  tree = render(PlatformPlaylistNameDialog, props)
  elements(tree.props.children, 'form')[0].props.onSubmit!({ preventDefault() {} })
  return tree
}

beforeEach(() => {
  vi.clearAllMocks()
  h.slots = []; h.effects = []; h.session = 0; h.signature = 'original'
  h.inspect.mockResolvedValue({ playlistId: '2', name: '通勤' })
  h.mutate.mockResolvedValue({ playlistId: '2', status: 'complete', requested: 1, completed: 1 })
  h.list.mockResolvedValue([playlist])
})
afterEach(unmount)

describe('平台歌单新建与改名', () => {
  it('重复提交只发送一次创建，关闭重开使用新的 UUID', async () => {
    let finish!: (value: unknown) => void
    h.mutate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const props = { source: 'netease' as const, onClose: vi.fn() }
    fillAndSubmit(props)
    fillAndSubmit(props)
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledOnce())
    const firstId = h.mutate.mock.calls[0][1].requestId
    expect(firstId).toMatch(/^[a-f0-9-]{36}$/)
    unmount()
    h.slots = []; h.effects = []
    fillAndSubmit(props)
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(2))
    expect(h.mutate.mock.calls[1][1].requestId).not.toBe(firstId)
    finish({ playlistId: '3', status: 'complete', requested: 1, completed: 1 })
  })

  it('网易云新建可选公开，默认私密；QQ 不提供公开开关', async () => {
    const props = { source: 'netease' as const, onClose: vi.fn() }
    const tree = render(PlatformPlaylistNameDialog, props)
    expect(renderToStaticMarkup(tree)).toContain('<span>私有歌单</span>')
    const lock = elements(tree.props.children, 'button').find(button => 'aria-pressed' in button.props)!
    expect(renderToStaticMarkup(lock)).toContain('改为公开歌单')
    lock.props.onClick!()
    expect(renderToStaticMarkup(render(PlatformPlaylistNameDialog, props))).toContain('<span>公开歌单</span>')
    fillAndSubmit(props)
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledOnce())
    expect(h.mutate.mock.calls[0][1]).toMatchObject({ action: 'create', name: '新歌单', public: true })
    unmount(); h.slots = []; h.effects = []
    expect(elements(render(PlatformPlaylistNameDialog, { source: 'qq' as const, onClose: vi.fn() }).props.children, 'button').filter(button => 'aria-pressed' in button.props)).toHaveLength(0)
  })

  it('使用同一请求标识重试创建，未确认时保留弹窗且不报告成功', async () => {
    h.mutate.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({ playlistId: '', status: 'unknown', requested: 1, completed: null })
    const props = { source: 'netease' as const, onClose: vi.fn(), onCreated: vi.fn() }
    fillAndSubmit(props)
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledOnce())
    await Promise.resolve()
    fillAndSubmit(props)
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(2))
    expect(h.mutate.mock.calls[0][1]).toEqual({ action: 'create', name: '新歌单', requestId: expect.any(String) })
    expect(h.mutate.mock.calls[1][1]).toEqual(h.mutate.mock.calls[0][1])
    expect(props.onCreated).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
    expect(elements(render(PlatformPlaylistNameDialog, props).props.children, 'input')[0].props.disabled).toBe(true)
  })

  it('改名前核验归属，拒绝收藏或他人歌单', async () => {
    h.inspect.mockRejectedValue(new Error('只能管理当前账号创建的普通歌单'))
    const props = { source: 'netease' as const, playlist, onClose: vi.fn() }
    fillAndSubmit(props, '改名')
    await vi.waitFor(() => expect(h.inspect).toHaveBeenCalledOnce())
    expect(h.mutate).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it.each(['close', 'unmount', 'account'])('%s 后丢弃迟到创建回执', async action => {
    let finish!: (value: unknown) => void
    h.mutate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const props = { source: 'netease' as const, onClose: vi.fn(), onCreated: vi.fn() }
    const tree = fillAndSubmit(props)
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledOnce())
    if (action === 'close') tree.props.onClose()
    if (action === 'unmount') unmount()
    if (action === 'account') h.session++
    finish({ playlistId: '3', status: 'complete', requested: 1, completed: 1 })
    await Promise.resolve(); await Promise.resolve()
    expect(props.onCreated).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
  })
})

describe('选择平台歌单增量加入', () => {
  it('读取清单后直接展示全部自建歌单，不逐个核验，并兼容列表缺少 type', async () => {
    h.list.mockResolvedValue([playlist, { ...playlist, id: '3' }, { ...playlist, id: '4' }, { ...playlist, type: undefined, id: '5' }])
    const props = { source: 'netease' as const, loadTracks: async () => [track], onClose: vi.fn() }
    render(PlatformPlaylistPicker, props)
    await listed()
    const tree = render(PlatformPlaylistPicker, props)
    expect(elements(tree.props.children, 'button').filter(button => renderToStaticMarkup(button).includes('加入 通勤'))).toHaveLength(4)
    expect(h.inspect).not.toHaveBeenCalled()
  })

  it('新建成功后加入失败时保留已创建目标，不重复新建', async () => {
    h.mutate.mockRejectedValue(new Error('加入失败'))
    const props = { source: 'netease' as const, loadTracks: async () => [track], onClose: vi.fn(), onDone: vi.fn() }
    click(render(PlatformPlaylistPicker, props), '新建并加入')
    const child = Children.toArray(render(PlatformPlaylistPicker, props).props.children)
      .find((item): item is ReactElement<{ onCreated(id: string, name: string): void; onClose(): void }> => isValidElement(item) && item.type === PlatformPlaylistNameDialog)!
    expect(child).toBeTruthy()
    child.props.onCreated('3', '新建通勤')
    child.props.onClose()
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledOnce())
    await Promise.resolve()
    const tree = render(PlatformPlaylistPicker, props)
    expect(renderToStaticMarkup(tree.props.children)).toContain('歌单会保留')
    expect(elements(tree.props.children, 'button').some(button => renderToStaticMarkup(button).includes('加入 新建通勤'))).toBe(true)
    expect(h.mutate.mock.calls[0][1].action).toBe('add')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('取消后加载的迟到歌曲不能写入平台', async () => {
    let finish!: (value: Track[]) => void
    const props = { source: 'netease' as const, loadTracks: () => new Promise<Track[]>(resolve => { finish = resolve }), onClose: vi.fn(), onDone: vi.fn() }
    render(PlatformPlaylistPicker, props)
    await listed()
    const tree = render(PlatformPlaylistPicker, props)
    click(tree, '加入 通勤')
    click(tree, '取消')
    finish([track])
    await Promise.resolve(); await Promise.resolve()
    expect(h.mutate).not.toHaveBeenCalled()
    expect(props.onDone).not.toHaveBeenCalled()
  })

  it('按清单字段只展示自建普通歌单，写入前再核验，允许不可播歌曲收藏', async () => {
    h.list.mockResolvedValue([
      playlist,
      { ...playlist, id: '9', name: '收藏的歌单', subscribed: true },
      { ...playlist, id: '10', name: '我喜欢的音乐', specialType: 5 },
      { ...playlist, id: '12', name: '视频歌单', specialType: 200 },
      { ...playlist, id: '13', name: '年度歌单', specialType: 20 },
      { ...playlist, source: 'qq', provider: 'qq', id: '11', name: '别的平台' },
    ])
    const props = { source: 'netease' as const, loadTracks: vi.fn(async () => [track]), onClose: vi.fn(), onDone: vi.fn() }
    render(PlatformPlaylistPicker, props)
    await listed()
    const tree = render(PlatformPlaylistPicker, props)
    const markup = renderToStaticMarkup(tree.props.children)
    for (const hidden of ['收藏的歌单', '我喜欢的音乐', '视频歌单', '别的平台']) expect(markup).not.toContain(hidden)
    expect(markup).toContain('加入 年度歌单')
    click(tree, '加入 通勤')
    await vi.waitFor(() => expect(props.onDone).toHaveBeenCalledOnce())
    expect(h.inspect).toHaveBeenCalledOnce()
    expect(h.mutate.mock.calls[0][1]).toMatchObject({ action: 'add', playlistId: '2', tracks: [{ source: 'netease', id: '1' }] })
  })

  it('QQ 排除「我喜欢」，公开与私密自建歌单都可选', async () => {
    const qq = { ...playlist, source: 'qq' as const, provider: 'qq' as const }
    h.list.mockResolvedValue([{ ...qq, name: '私密' }, { ...qq, id: 'qq-liked:201', name: '我喜欢' }, { ...qq, id: '7', name: '公开', private: false }])
    const props = { source: 'qq' as const, loadTracks: async () => [track], onClose: vi.fn() }
    render(PlatformPlaylistPicker, props)
    await listed()
    const markup = renderToStaticMarkup(render(PlatformPlaylistPicker, props).props.children)
    expect(markup).toContain('加入 私密')
    expect(markup).toContain('加入 公开')
    expect(markup).not.toContain('加入 我喜欢')
  })

  it('拒绝混入其他平台歌曲，保留弹窗且不发送写入', async () => {
    const props = { source: 'netease' as const, loadTracks: async () => [track, { ...track, source: 'qq' as const }], onClose: vi.fn(), onDone: vi.fn() }
    render(PlatformPlaylistPicker, props)
    await listed()
    click(render(PlatformPlaylistPicker, props), '加入 通勤')
    await Promise.resolve(); await Promise.resolve()
    expect(h.mutate).not.toHaveBeenCalled()
    expect(props.onDone).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(render(PlatformPlaylistPicker, props).props.children)).toContain('不会自动匹配其他版本')
  })

  it('部分成功不关闭、不清空选区，并提供刷新建议', async () => {
    h.mutate.mockResolvedValue({ playlistId: '2', status: 'partial', requested: 2, completed: 1 })
    const props = { source: 'netease' as const, loadTracks: async () => [track], onClose: vi.fn(), onDone: vi.fn() }
    render(PlatformPlaylistPicker, props)
    await listed()
    click(render(PlatformPlaylistPicker, props), '加入 通勤')
    await vi.waitFor(() => expect(h.mutate).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(props.onDone).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(render(PlatformPlaylistPicker, props).props.children)).toContain('刷新歌单核对结果')
  })
})
