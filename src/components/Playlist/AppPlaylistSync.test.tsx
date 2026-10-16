import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPlaylistSync } from './AppPlaylistSync'
import { AppPlaylistSyncDialog } from './AppPlaylistSyncDialog'
import type { AppPlaylist } from '../../stores/app-playlists'
import type { Track } from '../../types/domain'
import type { PlaylistSyncReport, PlaylistSyncSession, PlaylistSyncSnapshot } from '../../types/playlist-sync'

const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], epoch: 0, stateWrites: 0,
  item: null as AppPlaylist | null, getSession: vi.fn(), read: vi.fn(), pull: vi.fn(), sync: vi.fn(), toast: vi.fn(), tracks: vi.fn(), skeleton: vi.fn(),
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => 'sync-dialog',
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const index = h.cursor++
    const previous = h.slots[index] as { deps: unknown[]; value: unknown } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) h.slots[index] = { deps, value: factory() }
    return (h.slots[index] as { value: unknown }).value
  },
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = initial
    return [h.slots[index], (value: unknown) => { h.stateWrites += 1; h.slots[index] = typeof value === 'function' ? value(h.slots[index]) : value }]
  },
  useRef: (initial: unknown) => h.slots[h.cursor++] ??= { current: initial },
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => {
    const index = h.cursor++
    const previous = h.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) h.effects.push(() => {
      previous?.cleanup?.()
      h.slots[index] = { deps, cleanup: effect() }
    })
  },
}))
vi.mock('../../providers/registry', () => ({ providerFor: () => ({ playlistWriter: { getPlaylistSyncSession: h.getSession }, catalog: { getTracksByIds: h.tracks, getPlaylistSkeleton: h.skeleton } }) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (selector: (state: unknown) => unknown) => selector({
  byId: { netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' } },
}) }))
vi.mock('../../stores/app-playlists', () => ({ useAppPlaylistsStore: { getState: () => ({ items: h.item ? [h.item] : [] }) } }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))
vi.mock('../../lib/provider-account-session', () => ({ providerAccountSession: () => h.epoch }))
vi.mock('../../lib/app-playlist-sync', () => ({ appPlaylistSyncReason: () => '', readAppPlaylistSnapshot: h.read, pullAppPlaylist: h.pull, syncAppPlaylist: h.sync }))

const session: PlaylistSyncSession = { accountId: '12', accountToken: 'private-token' }
const snapshot = (name = '通勤', ids = ['1', '2']): PlaylistSyncSnapshot => ({ name, revision: `revision-${ids.join('-')}`, tracks: ids.map(id => ({ source: 'netease', id })) })
const report = (overrides: Partial<PlaylistSyncReport> = {}): PlaylistSyncReport => ({ requested: 2, matched: 2, added: 1, removed: 0,
  missingIds: [], extraIds: [], name: 'done', order: 'done', issues: [], ...overrides })
function playlist(linked = true): AppPlaylist {
  return { id: 'app', name: '通勤', createdAt: 1, updatedAt: 1,
    tracks: ['1', '2'].map(id => ({ source: 'netease', provider: 'netease', id, type: 'song', name: `歌曲${id}`, artist: '', artists: [] })),
    ...(linked ? { neteaseSync: { '12': { playlistId: '99', base: snapshot() } } } : {}) }
}
type ElementProps = { children?: ReactNode; disabled?: boolean; onClick?(): void; onChange?(): void; onSubmit?(event: { preventDefault(): void }): void; [key: string]: unknown }
function nodes(node: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<ElementProps>(child)) return []
    if (typeof child.type === 'function' && child.type !== AppPlaylistSyncDialog) {
      return [child, ...nodes((child.type as (props: ElementProps) => ReactNode)(child.props))]
    }
    return [child, ...nodes(child.props.children)]
  })
}
function render() {
  const outer = AppPlaylistSync({ item: h.item! }) as ReactElement<{ children: ReactElement[] }>
  const platform = outer.props.children[0]
  h.cursor = 0
  const tree = (platform.type as (props: unknown) => ReactElement)(platform.props)
  h.effects.splice(0).forEach(effect => effect())
  return tree
}
function button(label: string) {
  return nodes(render()).find(node => node.type === 'button' && renderToStaticMarkup(node).includes(label))!
}
function click(label: string) { button(label).props.onClick!() }
async function ready(linked = true) {
  h.item = playlist(linked)
  render()
  await Promise.resolve()
  render()
}
async function checked(cloud = snapshot()) {
  h.read.mockResolvedValueOnce(cloud)
  click('检查变更')
  await vi.waitFor(() => expect(button('检查变更').props.disabled).toBe(false))
}
function unmount() { h.slots.forEach(slot => (slot as { cleanup?: () => void } | undefined)?.cleanup?.()) }

beforeEach(() => {
  vi.clearAllMocks()
  h.slots = []; h.effects = []; h.epoch = 0; h.stateWrites = 0
  h.item = playlist()
  h.getSession.mockResolvedValue(session)
  h.pull.mockResolvedValue(undefined)
  h.tracks.mockResolvedValue([])
  h.skeleton.mockResolvedValue({ tracks: [] })
  h.sync.mockResolvedValue({ status: 'complete', success: true, playlistId: '99', snapshot: snapshot(), report: report() })
})
afterEach(unmount)

describe('应用歌单手动同步流程', () => {
  it('首次创建云端歌单，写入期间禁止重复提交', async () => {
    await ready(false)
    let finish!: (value: unknown) => void
    h.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    click('创建云端歌单')
    expect(button('创建云端歌单').props.disabled).toBe(true)
    click('创建云端歌单')
    expect(h.sync).toHaveBeenCalledTimes(1)
    expect(h.sync).toHaveBeenCalledWith('app', session, 'netease', undefined)
    finish({ status: 'complete', success: true, snapshot: snapshot(), report: report() })
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledOnce())
  })

  it('关联后必须先检查；两端无变更显示一致', async () => {
    await ready()
    expect(renderToStaticMarkup(render())).not.toContain('推送应用更改')
    await checked()
    expect(renderToStaticMarkup(render())).toContain('两端一致')
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('检查后展示应用和云端更改，云端更改优先拉取', async () => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    const cloud = snapshot('云端名称', ['1', '2', '3'])
    await checked(cloud)
    const html = renderToStaticMarkup(render())
    expect(html).toContain('新增 1 首')
    expect(html).toContain('移除 1 首')
    expect(html).toContain('云端名称')
    expect(html).not.toContain('推送应用更改')
    click('拉取并合并')
    await vi.waitFor(() => expect(h.pull).toHaveBeenCalledWith('app', session, 'netease', cloud, undefined, undefined))
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('云端已对齐时明确推送移除范围，传入检查快照', async () => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    const cloud = snapshot()
    await checked(cloud)
    expect(renderToStaticMarkup(render())).toContain('将移除云端额外的 1 首歌曲')
    click('推送应用更改')
    await vi.waitFor(() => expect(h.sync).toHaveBeenCalledWith('app', session, 'netease', cloud))
  })

  it('名称冲突打开选择框，选择后才执行拉取', async () => {
    await ready()
    h.item!.name = '应用名称'
    const cloud = snapshot('云端名称')
    await checked(cloud)
    click('拉取并合并')
    expect(h.pull).not.toHaveBeenCalled()
    const dialog = nodes(render()).find(node => node.type === AppPlaylistSyncDialog)!
    expect(dialog.props.conflicts).toEqual([{ id: 'name', kind: 'name' }])
    const submit = dialog.props.onSubmit as unknown as Parameters<typeof AppPlaylistSyncDialog>[0]['onSubmit']
    submit({ name: 'cloud' })
    await vi.waitFor(() => expect(h.pull).toHaveBeenCalledWith('app', session, 'netease', cloud, { name: 'cloud' }, undefined))
  })

  it.each(['local', 'cloud'] as const)('旧关联首次对齐必须显式选择 %s', async initial => {
    await ready()
    delete h.item!.neteaseSync!['12'].base
    const cloud = snapshot('云端名称', ['3'])
    await checked(cloud)
    expect(renderToStaticMarkup(render())).toContain('尚无共同基准')
    expect(h.pull).not.toHaveBeenCalled()
    click(initial === 'local' ? '保留应用内容，准备推送' : '采用云端内容')
    await vi.waitFor(() => expect(h.pull).toHaveBeenCalledWith('app', session, 'netease', cloud, undefined, initial))
  })

  it('显示存档中的未完成报告，不把未确认结果说成成功', async () => {
    await ready()
    h.item!.neteaseSync!['12'].lastReport = report({ matched: null, added: null, missingIds: ['2'], name: 'pending', order: 'unknown', issues: [{ step: 'read', message: '读取结果失败，请检查后重试' }] })
    const html = renderToStaticMarkup(render())
    expect(html).toContain('平台尚未确认结果')
    expect(html).toContain('未加入：歌曲2')
    expect(html).toContain('名称未完成')
    expect(html).toContain('顺序待确认')
    expect(button('重试未完成项').props.disabled).toBe(false)
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('未确认最终结果时不把空missing列表当成零首失败', async () => {
    await ready(false)
    h.sync.mockResolvedValueOnce({ status: 'partial', success: false, snapshot: snapshot(), report: report({ matched: null, added: null, removed: null }) })
    click('创建云端歌单')
    await vi.waitFor(() => expect(button('创建云端歌单').props.disabled).toBe(false))
    const html = renderToStaticMarkup(render())
    expect(html).toContain('未加入数量待确认')
    expect(html).not.toContain('未加入 0 首')
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('拉取成功清除当前组件记住的上次部分报告', async () => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    await checked()
    h.sync.mockResolvedValueOnce({ status: 'partial', success: false, snapshot: snapshot(), report: report({ missingIds: ['1'] }) })
    click('推送应用更改')
    await vi.waitFor(() => expect(button('检查变更').props.disabled).toBe(false))
    expect(renderToStaticMarkup(render())).toContain('上次推送部分完成')
    const cloud = snapshot('云端改名')
    await checked(cloud)
    h.pull.mockImplementationOnce(async () => { h.item!.neteaseSync!['12'] = { playlistId: '99', base: cloud } })
    click('拉取并合并')
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledOnce())
    expect(renderToStaticMarkup(render())).not.toContain('上次推送部分完成')
  })

  it('检查失败后不继续提供基于上次云端快照的推送', async () => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    await checked()
    expect(button('推送应用更改')).toBeDefined()
    h.read.mockRejectedValueOnce(new Error('读取失败，请重试'))
    click('检查变更')
    await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain('读取失败，请重试'))
    expect(renderToStaticMarkup(render())).not.toContain('推送应用更改')
  })

  it('冲突内容更改会更新对话框key，并拒绝已取出的旧选择回调', async () => {
    await ready()
    h.item!.name = '应用名称'
    await checked(snapshot('云端名称'))
    click('拉取并合并')
    const original = nodes(render()).find(node => node.type === AppPlaylistSyncDialog)!
    const submit = original.props.onSubmit as unknown as Parameters<typeof AppPlaylistSyncDialog>[0]['onSubmit']
    h.item = { ...h.item!, name: '修改后的应用名称' }
    const updated = nodes(render()).find(node => node.type === AppPlaylistSyncDialog)!
    expect(updated.key).not.toEqual(original.key)
    submit({ name: 'local' })
    expect(h.pull).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(render())).toContain('请重新检查并选择')
  })

  it('账号变化后丢弃迟到推送报告和成功提示', async () => {
    await ready(false)
    let finish!: (value: unknown) => void
    h.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    click('创建云端歌单')
    h.epoch += 1
    render()
    finish({ status: 'complete', success: true, snapshot: snapshot(), report: report() })
    await Promise.resolve()
    await Promise.resolve()
    expect(renderToStaticMarkup(render())).not.toContain('上次推送')
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('重试先读取云端；出现云端新更改时拉取，不直接推送', async () => {
    await ready()
    h.item!.neteaseSync!['12'].lastReport = report({ missingIds: ['2'] })
    const cloud = snapshot('云端改名')
    h.read.mockResolvedValueOnce(cloud)
    click('重试未完成项')
    await vi.waitFor(() => expect(h.pull).toHaveBeenCalledOnce())
    expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.pull.mock.invocationCallOrder[0])
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('重试先检查，云端仍对齐时补推应用内容', async () => {
    await ready()
    h.item!.neteaseSync!['12'].lastReport = report({ missingIds: ['2'] })
    h.read.mockResolvedValueOnce(snapshot())
    click('重试未完成项')
    await vi.waitFor(() => expect(h.sync).toHaveBeenCalledOnce())
    expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.sync.mock.invocationCallOrder[0])
  })

  it.each(['account', 'unmount'])('%s 变化后取消检查并丢弃迟到结果', async action => {
    await ready()
    let finish!: (value: PlaylistSyncSnapshot) => void
    h.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    click('检查变更')
    const signal = h.read.mock.calls[0][3] as AbortSignal
    if (action === 'account') { h.epoch += 1; render() }
    else unmount()
    expect(signal.aborted).toBe(true)
    finish(snapshot('过期云端名称'))
    await Promise.resolve()
    await Promise.resolve()
    if (action === 'account') expect(renderToStaticMarkup(render())).not.toContain('过期云端名称')
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('QQ 本地顺序不算待推送更改，云端顺序仍可拉取', async () => {
    h.item = playlist(false)
    h.item.tracks.forEach(track => { track.source = 'qq'; track.provider = 'qq'; track.qqId = `id-${track.id}` })
    const base: PlaylistSyncSnapshot = { ...snapshot(), tracks: h.item.tracks.map(track => ({ source: 'qq', id: String(track.id), qqId: String(track.qqId) })) }
    h.item.qqSync = { '12': { playlistId: '99', base } }
    render(); await Promise.resolve(); render()
    h.item.tracks.reverse()
    await checked(base)
    expect(renderToStaticMarkup(render())).toContain('两端一致')
    expect(renderToStaticMarkup(render())).toContain('不支持推送歌曲顺序')
    await checked({ ...base, revision: 'reordered', tracks: [...base.tracks].reverse() })
    expect(button('拉取并合并')).toBeDefined()
  })
})

describe('同步变更的只读曲名补全', () => {
  const metadataTrack = (id: string, name: string, source: 'netease' | 'qq' = 'netease'): Track => ({ source, provider: source, id, name, type: 'song', artist: '', artists: [] })

  it('补全已在应用删除的云端曲名，用于更改详情和删除冲突', async () => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    h.tracks.mockResolvedValueOnce([metadataTrack('2', '认得出的歌曲'), metadataTrack('2', '错误平台歌曲', 'qq'), metadataTrack('999', '不在当前快照')])
    await checked(snapshot('通勤', ['2', '1']))
    await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain('认得出的歌曲'))
    expect(h.tracks).toHaveBeenCalledWith(['2'])
    click('拉取并合并')
    const dialog = nodes(render()).find(node => node.type === AppPlaylistSyncDialog)!
    const songName = dialog.props.songName as (id: string) => string
    expect(songName('2')).toBe('认得出的歌曲')
    expect(songName('999')).toBe('歌曲 ID 999')
    expect(h.pull).not.toHaveBeenCalled()
  })

  it('网易批量加载缺少的名称，避免逐首请求', async () => {
    await ready()
    h.tracks.mockImplementation(async (ids: string[]) => ids.map(id => metadataTrack(id, `云端歌曲${id}`)))
    await checked(snapshot('通勤', Array.from({ length: 205 }, (_, index) => String(index + 1))))
    await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain('云端歌曲205'))
    expect(h.tracks.mock.calls.map(call => call[0].length)).toEqual([100, 100, 3])
    expect(h.skeleton).not.toHaveBeenCalled()
  })

  it('QQ只读取一次歌单骨架，过滤平台和快照外歌曲并保留本地名称', async () => {
    h.item = playlist(false)
    h.item.tracks = [metadataTrack('1', '应用原名称', 'qq')]
    const base: PlaylistSyncSnapshot = { ...snapshot(), tracks: ['1', '2'].map(id => ({ source: 'qq', id })) }
    h.item.qqSync = { '12': { playlistId: '99', base } }
    h.skeleton.mockResolvedValueOnce({ tracks: [metadataTrack('1', '不应替换本地', 'qq'), metadataTrack('2', 'QQ云端歌曲', 'qq'), metadataTrack('2', '错误平台'), metadataTrack('4', '快照外歌曲', 'qq')] })
    render(); await Promise.resolve(); render()
    await checked({ ...base, tracks: [...base.tracks].reverse() })
    await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain('QQ云端歌曲'))
    expect(h.skeleton).toHaveBeenCalledOnce()
    expect(h.skeleton).toHaveBeenCalledWith('99')
    expect(h.tracks).not.toHaveBeenCalled()
    click('拉取并合并')
    const dialog = nodes(render()).find(node => node.type === AppPlaylistSyncDialog)!
    const songName = dialog.props.songName as (id: string) => string
    expect(songName('1')).toBe('应用原名称')
    expect(songName('2')).toBe('QQ云端歌曲')
    expect(songName('4')).toBe('歌曲 ID 4')
    expect(h.pull).not.toHaveBeenCalled()
  })

  it.each(['check', 'account'])('%s 变化时丢弃旧曲名，保留新检查补全的名称', async action => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    let finish!: (tracks: Track[]) => void
    h.tracks.mockImplementationOnce(() => new Promise<Track[]>(resolve => { finish = resolve }))
    const cloud = snapshot('通勤', ['2', '1'])
    await checked(cloud)
    expect(h.tracks).toHaveBeenCalledOnce()
    expect(button('拉取并合并').props.disabled).toBe(false)
    if (action === 'account') {
      h.item!.neteaseSync!['34'] = { playlistId: '88', base: snapshot() }
      h.getSession.mockResolvedValueOnce({ accountId: '34', accountToken: 'new-account-token' })
      h.epoch += 1
      render(); await Promise.resolve(); render()
    }
    h.tracks.mockResolvedValueOnce([metadataTrack('2', '当前曲名')])
    await checked({ ...cloud, revision: 'new-check' })
    await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain('当前曲名'))
    finish([metadataTrack('2', '迟到旧曲名')])
    await Promise.resolve()
    await Promise.resolve()
    const html = renderToStaticMarkup(render())
    expect(html).toContain('当前曲名')
    expect(html).not.toContain('迟到旧曲名')
  })

  it('卸载后曲名响应不再写入组件状态', async () => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    let finish!: (tracks: Track[]) => void
    h.tracks.mockImplementationOnce(() => new Promise<Track[]>(resolve => { finish = resolve }))
    await checked(snapshot('通勤', ['2', '1']))
    unmount()
    const writes = h.stateWrites
    finish([metadataTrack('2', '卸载后返回')])
    await Promise.resolve()
    await Promise.resolve()
    expect(h.stateWrites).toBe(writes)
  })

  it('读取曲名失败明确降级为歌曲ID，检查和合并仍可操作', async () => {
    await ready()
    h.item!.tracks = h.item!.tracks.slice(0, 1)
    h.tracks.mockRejectedValueOnce(new Error('曲名服务不可用'))
    await checked(snapshot('通勤', ['2', '1']))
    await vi.waitFor(() => expect(renderToStaticMarkup(render())).toContain('歌曲 ID 2'))
    expect(button('拉取并合并').props.disabled).toBe(false)
    expect(renderToStaticMarkup(render())).not.toContain('role="alert"')
    click('拉取并合并')
    expect(nodes(render()).some(node => node.type === AppPlaylistSyncDialog)).toBe(true)
  })
})

describe('同步冲突选择', () => {
  it('每项都选定后才能确认，提交应用/云端选择', () => {
    const onSubmit = vi.fn()
    const props = { local: snapshot('应用', ['1', '2']), cloud: snapshot('云端', ['2']),
      conflicts: [{ id: 'name', kind: 'name' as const }, { id: 'delete:netease:1', kind: 'delete' as const, trackId: '1' }],
      songName: (id: string) => `歌曲${id}`, busy: false, onClose: vi.fn(), onSubmit }
    const dialog = () => { h.cursor = 0; return AppPlaylistSyncDialog(props) }
    const confirm = () => nodes(dialog().props.children).find(node => node.type === 'button' && node.props.type === 'submit')!
    expect(confirm().props.disabled).toBe(true)
    const inputs = () => nodes(dialog().props.children).filter(node => node.type === 'input')
    inputs()[1].props.onChange!()
    expect(confirm().props.disabled).toBe(true)
    inputs()[2].props.onChange!()
    expect(confirm().props.disabled).toBe(false)
    const form = nodes(dialog().props.children).find(node => node.type === 'form')!
    form.props.onSubmit!({ preventDefault() {} })
    expect(onSubmit).toHaveBeenCalledWith({ name: 'cloud', 'delete:netease:1': 'local' })
  })
})
