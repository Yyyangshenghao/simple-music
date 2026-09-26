import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { AppleMusicPlayback, openAppleMusicPlayer, type ApplePlaybackState, type ApplePlaybackCommand } from './apple-music-playback'

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

describe('Apple Music 登录窗口', () => {
  const open = vi.fn()
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', { open })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('默认请求官网登录并允许浏览器启动，主进程已打开时不创建第二个窗口', async () => {
    vi.mocked(api.post).mockResolvedValue({ opened: true })
    await openAppleMusicPlayer()
    expect(api.post).toHaveBeenCalledWith('/api/apple-music/bridge/open', { mode: 'web' }, undefined, { timeoutMs: 60_000 })
    expect(open).not.toHaveBeenCalled()
  })

  it('开发者备用模式仍打开返回的授权页面', async () => {
    vi.mocked(api.post).mockResolvedValue({ url: 'http://127.0.0.1:35530/apple-music-bridge/#session' })
    await openAppleMusicPlayer('developer')
    expect(api.post).toHaveBeenCalledWith('/api/apple-music/bridge/open', { mode: 'developer' }, undefined, { timeoutMs: 60_000 })
    expect(open).toHaveBeenCalledWith('http://127.0.0.1:35530/apple-music-bridge/#session', '_blank', 'noopener,noreferrer')
  })

  it('启动错误向登录界面传递且不误打开空白页', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('受保护媒体组件加载失败'))
    await expect(openAppleMusicPlayer()).rejects.toThrow('受保护媒体组件加载失败')
    vi.mocked(api.post).mockResolvedValue({ opened: false })
    await expect(openAppleMusicPlayer()).rejects.toThrow('未能打开')
    expect(open).not.toHaveBeenCalled()
  })
})

function sent(index = 0): ApplePlaybackCommand {
  return vi.mocked(api.post).mock.calls[index][1] as ApplePlaybackCommand
}

function state(playbackId: string, extra: Partial<ApplePlaybackState> = {}): ApplePlaybackState {
  return { connected: true, loggedIn: true, subscription: 'active', playbackId, status: 'playing', position: 30, duration: 180, ...extra }
}

describe('Apple Music 播放控制', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(api.post).mockResolvedValue({ ok: true })
  })
  afterEach(() => { vi.useRealTimers() })

  it('加载后同步进度，暂停/拖动/音量与当前会话绑定', async () => {
    const onState = vi.fn()
    const player = new AppleMusicPlayback(onState)
    vi.mocked(api.get).mockImplementation(async () => state(sent().playbackId))
    await player.load('123', false, 15, true, .6)
    await vi.advanceTimersByTimeAsync(0)
    const load = sent()
    expect(load).toMatchObject({ type: 'load', id: '123', startAt: 15, autoplay: true, volume: .6 })
    expect(onState).toHaveBeenCalledWith(state(load.playbackId))
    await player.command({ type: 'pause' })
    await player.command({ type: 'seek', seconds: 50 })
    await player.command({ type: 'volume', volume: .2 })
    expect(api.post).toHaveBeenLastCalledWith('/api/apple-music/bridge/command', { type: 'volume', volume: .2, playbackId: load.playbackId })
    player.stop()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('停止后丢弃未返回的旧状态', async () => {
    let finish!: (value: ApplePlaybackState) => void
    vi.mocked(api.get).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const onState = vi.fn()
    const player = new AppleMusicPlayback(onState)
    await player.load('123', false, 0, true, 1)
    const id = sent().playbackId
    player.stop()
    finish(state(id))
    await vi.advanceTimersByTimeAsync(2000)
    expect(onState).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledOnce()
  })

  it('跨曲目实例控制仍然有序，已排队但取消的 load 不再送出', async () => {
    const first = new AppleMusicPlayback(vi.fn())
    const second = new AppleMusicPlayback(vi.fn())
    vi.mocked(api.get).mockResolvedValue(state('ignored'))
    const old = first.load('old', false, 0, true, 1)
    first.stop()
    const next = second.load('new', false, 0, true, 1)
    await Promise.all([old, next])
    expect(vi.mocked(api.post).mock.calls.map((_, index) => sent(index).type)).toEqual(['stop', 'load'])
    expect(api.post).toHaveBeenLastCalledWith('/api/apple-music/bridge/command', expect.objectContaining({ id: 'new' }))
    second.stop()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('一次命令失败不阻塞后续实例的播放命令', async () => {
    const first = new AppleMusicPlayback(vi.fn())
    const second = new AppleMusicPlayback(vi.fn())
    vi.mocked(api.post).mockRejectedValueOnce(new Error('connection lost'))
    await expect(first.load('old', false, 0, true, 1)).rejects.toThrow('connection lost')
    vi.mocked(api.get).mockImplementation(async () => state(sent(1).playbackId))
    await second.load('new', false, 0, true, 1)
    expect(sent(1)).toMatchObject({ type: 'load', id: 'new' })
    second.stop()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('已经发出的旧加载必须先结束，再发送停止和新加载', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(api.get).mockResolvedValue(state('ignored'))
    const firstState = vi.fn()
    const first = new AppleMusicPlayback(firstState)
    const second = new AppleMusicPlayback(vi.fn())
    const old = first.load('old', false, 0, true, 1)
    await vi.advanceTimersByTimeAsync(0)
    first.stop()
    const next = second.load('new', false, 0, true, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.post).toHaveBeenCalledOnce()
    finish({ ok: true })
    await Promise.all([old, next])
    expect(vi.mocked(api.post).mock.calls.map((_, index) => sent(index).type)).toEqual(['load', 'stop', 'load'])
    expect(firstState).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledOnce()
    second.stop()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('停止后晚到的轮询失败不再通知错误或重启轮询', async () => {
    let reject!: (error: Error) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const onState = vi.fn()
    const player = new AppleMusicPlayback(onState)
    await player.load('123', false, 0, true, 1)
    player.stop()
    reject(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(onState).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledOnce()
  })

  it('断线报告可操作错误且停止轮询', async () => {
    vi.mocked(api.get).mockResolvedValue(state('', { connected: false }))
    const onState = vi.fn()
    const player = new AppleMusicPlayback(onState)
    await player.load('123', false, 0, true, 1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: expect.stringContaining('断开') }))
    expect(api.get).toHaveBeenCalledOnce()
    player.stop()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('旧 playbackId 不能更新当前曲目，自然完成只通知一次', async () => {
    const onState = vi.fn()
    const player = new AppleMusicPlayback(onState)
    vi.mocked(api.get).mockResolvedValueOnce(state('old'))
    vi.mocked(api.get).mockImplementation(async () => state(sent().playbackId, { status: 'ended' }))
    await player.load('123', false, 0, true, 1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(onState).toHaveBeenCalledOnce()
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ status: 'ended' }))
    player.stop()
    await vi.advanceTimersByTimeAsync(0)
  })
})
