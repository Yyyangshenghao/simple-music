import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('./playback-shared-stores', async () => {
  const { createStore } = await import('zustand/vanilla')
  return {
    playbackStores: {
      player: createStore(() => ({ status: 'idle', position: 0, duration: 100, rate: 1,
        play: vi.fn(), pause: vi.fn(), _engine: vi.fn(() => { throw new Error('UI engine created') }),
        _lyricPosition: vi.fn(), _frequencyData: vi.fn() })),
      playlist: createStore(() => ({ queue: [], addManyToQueue: vi.fn() })),
      providers: createStore(() => ({ byId: {} })),
      downloads: createStore(() => ({ saveMany: vi.fn() })),
      apple: createStore(() => ({ refresh: vi.fn() })),
      navigation: createStore(() => ({ currentView: 'explore', navigateTo: vi.fn() })),
      toast: createStore(() => ({ message: null, show: vi.fn(), dismiss: vi.fn() })),
    },
    remoteActions: { player: ['play', 'pause'], playlist: ['addManyToQueue'], providers: [],
      downloads: ['saveMany'], apple: ['refresh'], navigation: ['navigateTo'], toast: ['show', 'dismiss'] }
  }
})
vi.mock('./provider-request-cache', () => ({ clearProviderRequestCache: vi.fn() }))
vi.mock('../stores/provider-auth', () => ({ initProviderAuthFailureSync: vi.fn(() => vi.fn()) }))

let stop: (() => void) | undefined
beforeEach(() => { vi.resetModules(); vi.useFakeTimers() })
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

async function setup() {
  const doc = Object.assign(new EventTarget(), { hidden: false, body: {} })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('localStorage', { getItem: () => null })
  let publish!: (value: unknown) => void
  const initial = {
    session: 'host-1', revision: 1, full: true,
    stores: { player: { status: 'playing', position: 12 }, navigation: { currentView: 'shuange' } },
    accountSessions: { netease: 3, qq: 1, apple: 0 }
  }
  const request = vi.fn(async (value: Record<string, unknown>): Promise<unknown> => {
    if (value.type === 'connect') return initial
    if (value.action === 'addManyToQueue') return 2
    return undefined
  })
  const off = vi.fn()
  vi.stubGlobal('window', { desktop: { playbackRequest: request,
    onPlaybackSnapshot: (callback: typeof publish) => { publish = callback; return off } } })
  const { playbackStores: stores } = await import('./playback-shared-stores')
  const show = stores.toast.getState().show
  const { startPlaybackClient } = await import('./playback-client')
  stop = await startPlaybackClient()
  return { doc, request, initial, publish, off, stores, show }
}

it('先订阅后连接并镜像活跃导航，命令返回宿主真实结果且不会创建UI引擎', async () => {
  const h = await setup()
  expect(h.stores.navigation.getState().currentView).toBe('shuange')
  expect(h.stores.player.getState().status).toBe('playing')
  expect((h.stores.player.getState()._engine as () => { position: number })().position).toBeCloseTo(12, 1)
  const added = await (h.stores.playlist.getState().addManyToQueue as (...args: unknown[]) => Promise<number>)([], true)
  expect(added).toBe(2)
  expect(h.request).toHaveBeenCalledWith({ type: 'action', store: 'playlist', action: 'addManyToQueue', args: [[], true] })
  const { providerAccountSession } = await import('./provider-account-session')
  expect(providerAccountSession('netease')).toBe(3)
})

it('忽略旧revision，缺口重新读取完整快照，暂停后插值停止', async () => {
  const h = await setup()
  h.publish({ ...h.initial, full: false, revision: 1, stores: { player: { position: 1 } } })
  expect(h.stores.player.getState().position).toBe(12)
  h.publish({ ...h.initial, full: false, revision: 2, stores: { player: { status: 'paused', position: 13 } } })
  await vi.advanceTimersByTimeAsync(1000)
  expect((h.stores.player.getState()._lyricPosition as () => number)()).toBe(13)
  h.publish({ ...h.initial, full: false, revision: 4, stores: { player: { position: 99 } } })
  await Promise.resolve()
  expect(h.stores.player.getState().position).toBe(13)
  expect(h.request.mock.calls.filter(([request]) => request.type === 'connect')).toHaveLength(2)
})

it('频谱仅在可见且按需时订阅，隐藏立即停止并清空，宿主丢失时暂停镜像', async () => {
  const h = await setup()
  const read = h.stores.player.getState()._frequencyData as () => Uint8Array
  expect(read()).toHaveLength(0)
  expect(h.request).toHaveBeenCalledWith({ type: 'observe', visible: true, spectrum: true })
  h.publish({ type: 'spectrum', data: new Uint8Array([1, 2]) })
  expect([...read()]).toEqual([1, 2])
  h.doc.hidden = true
  h.doc.dispatchEvent(new Event('visibilitychange'))
  expect(read()).toHaveLength(0)
  expect(h.request).toHaveBeenCalledWith({ type: 'observe', visible: false, spectrum: false })
  h.publish({ type: 'host-error', error: 'PLAYBACK_HOST_GONE' })
  expect(h.stores.player.getState().status).toBe('paused')
  await expect((h.stores.player.getState().play as () => Promise<void>)()).rejects.toThrow('请重启应用')
})

it('异步操作移除不可克隆signal，以requestId发送取消', async () => {
  const h = await setup()
  let finish!: () => void
  h.request.mockImplementation(async value => value.type === 'action' ? new Promise<void>(resolve => { finish = resolve }) : undefined)
  const controller = new AbortController()
  const pending = (h.stores.downloads.getState().saveMany as (...args: unknown[]) => Promise<unknown>)([], controller.signal)
  const action = h.request.mock.calls.at(-1)![0]
  expect(action.args).toEqual([[]])
  expect(typeof action.requestId).toBe('string')
  controller.abort()
  expect(h.request).toHaveBeenCalledWith({ type: 'cancel', requestId: action.requestId })
  finish()
  await pending
})

it('UI输入和模态阻挡态同步后台，失焦后允许全局控制', async () => {
  const h = await setup()
  Object.assign(h.doc, {
    hasFocus: () => true,
    activeElement: { closest: () => ({ tagName: 'INPUT' }) },
  })
  h.doc.dispatchEvent(new Event('focusin'))
  expect(h.request).toHaveBeenCalledWith({ type: 'action', store: 'controls', action: 'setShortcutBlocked', args: [true] })
  Object.assign(h.doc, { hasFocus: () => false })
  h.doc.dispatchEvent(new Event('focusout'))
  expect(h.request).toHaveBeenCalledWith({ type: 'action', store: 'controls', action: 'setShortcutBlocked', args: [false] })
})

it('对话框变化同步快捷键阻挡态，隐藏时放行，停止连接释放观察', async () => {
  let onMutation!: () => void
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { onMutation = callback }
    observe = observe
    disconnect = disconnect
  })
  const h = await setup()
  h.request.mockClear()
  let open = true
  Object.assign(h.doc, { querySelector: () => open ? {} : null })
  expect(observe).toHaveBeenCalledWith(h.doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  onMutation()
  expect(h.request).toHaveBeenCalledWith({ type: 'action', store: 'controls', action: 'setShortcutBlocked', args: [true] })
  onMutation()
  expect(h.request.mock.calls.filter(([value]) => value.action === 'setShortcutBlocked')).toHaveLength(1)
  h.doc.hidden = true
  h.doc.dispatchEvent(new Event('visibilitychange'))
  onMutation()
  expect(h.request).toHaveBeenCalledWith({ type: 'action', store: 'controls', action: 'setShortcutBlocked', args: [false] })
  const calls = h.request.mock.calls.length
  open = false
  onMutation()
  open = true
  onMutation()
  expect(h.request).toHaveBeenCalledTimes(calls)
  h.doc.hidden = false
  onMutation()
  expect(h.request).toHaveBeenLastCalledWith({ type: 'action', store: 'controls', action: 'setShortcutBlocked', args: [true] })
  stop?.()
  stop = undefined
  expect(disconnect).toHaveBeenCalledOnce()
})

it('远程连接错误码转成可理解的提示，不展示IPC细节', async () => {
  const h = await setup()
  h.request.mockRejectedValueOnce(new Error('Error invoking remote method playback:request: PLAYBACK_BUSY'))
  await expect((h.stores.player.getState().play as () => Promise<void>)()).rejects.toThrow('PLAYBACK_BUSY')
  expect(h.show).toHaveBeenCalledWith('播放器正在处理较多操作，请稍后重试')
})
