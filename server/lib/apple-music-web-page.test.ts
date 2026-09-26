import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { appleMusicWebPage, type WebPageTask } from './apple-music-web-page'

function harness() {
  const events: Record<string, (event?: unknown) => void> = {}
  const music = {
    isAuthorized: true, storefrontId: 'cn', currentPlaybackTime: 0, currentPlaybackDuration: 180, playbackState: 0, volume: 1, previewOnly: true,
    hasMusicSubscription: vi.fn(async () => true),
    api: { music: vi.fn(async () => ({ data: { data: [{ id: '456', attributes: { durationInMillis: 180000 } }] } })) },
    stop: vi.fn(async () => { music.playbackState = 4 }), pause: vi.fn(async () => { music.playbackState = 3 }),
    play: vi.fn(async () => { music.playbackState = 2 }), setQueue: vi.fn(async () => ({})),
    seekToTime: vi.fn(async (seconds: number) => { music.currentPlaybackTime = seconds }),
    addEventListener: (name: string, callback: (event?: unknown) => void) => { events[name] = callback },
  }
  const context = createContext({ location: { origin: 'https://music.apple.com' }, MusicKit: { getInstance: () => music, Events: { mediaPlaybackError: 'error' }, PlaybackStates: { playing: 2, paused: 3, completed: 10, ended: 6 } } })
  const call = (task: WebPageTask) => { context.task = task; return runInContext(`(${appleMusicWebPage.toString()})(task)`, context) }
  const command = (type: string, extra = {}) => call({ type: 'command', generation: 0, command: { type, playbackId: 'p1', ...extra } } as WebPageTask)
  return { music, call, command, events, context }
}

describe('官网内 MusicKit 会话适配', () => {
  it('仅在 Apple 官网执行，其他来源不能调用 SDK', async () => {
    const h = harness()
    h.context.location.origin = 'https://example.com'
    await expect(h.call({ type: 'catalog', path: '/v1/catalog/cn/songs' })).rejects.toThrow('官网')
    expect(h.music.api.music).not.toHaveBeenCalled()
  })
  it('曲库通过页面 SDK 调用并解包，不读取令牌', async () => {
    const h = harness()
    const data = await h.call({ type: 'catalog', path: '/v1/catalog/cn/songs' })
    expect(h.music.api.music).toHaveBeenCalledWith('v1/catalog/cn/songs')
    expect(data.data[0].id).toBe('456')
    expect(await h.call({ type: 'state' })).not.toHaveProperty('token')
  })
  it('账号地区与落地页不一致时切换到账号曲库', async () => {
    const h = harness()
    h.music.storefrontId = 'us'
    h.music.api.music.mockResolvedValueOnce({ data: { data: [{ id: 'cn', attributes: { durationInMillis: 0 } }] } })

    expect(await h.call({ type: 'state' })).toMatchObject({
      storefront: 'cn',
      redirectUrl: 'https://music.apple.com/cn/new',
    })
  })
  it('状态跟随官网授权，恢复断点、音量与自然结束', async () => {
    const h = harness()
    await h.command('load', { id: '123', startAt: 20, volume: .4 })
    expect(h.music.setQueue).toHaveBeenCalledWith({ song: '123', startPlaying: false })
    expect(await h.call({ type: 'state' })).toMatchObject({ loggedIn: true, subscription: 'active', status: 'playing', position: 20 })
    expect(h.music.volume).toBe(.4)
    h.music.playbackState = 10
    expect(await h.call({ type: 'state' })).toMatchObject({ status: 'ended' })
  })
  it('明确无订阅时报告状态并在加载队列前阻止完整播放', async () => {
    const h = harness()
    h.music.hasMusicSubscription.mockResolvedValue(false)
    expect(await h.call({ type: 'state' })).toMatchObject({ loggedIn: true, subscription: 'inactive' })
    await h.command('load', { id: '123' })
    expect(h.music.setQueue).not.toHaveBeenCalled()
    expect(await h.call({ type: 'state' })).toMatchObject({
      subscription: 'inactive',
      status: 'error',
      error: expect.stringContaining('没有有效的 Apple Music 订阅'),
    })
  })
  it('订阅查询失败不误报无订阅，并在确认前阻止播放', async () => {
    const h = harness()
    h.music.hasMusicSubscription.mockRejectedValue(new Error('offline'))
    expect(await h.call({ type: 'state' })).toMatchObject({ subscription: 'unknown' })
    await h.command('load', { id: '123' })
    expect(h.music.setQueue).not.toHaveBeenCalled()
    expect(await h.call({ type: 'state' })).toMatchObject({
      subscription: 'unknown',
      status: 'error',
      error: expect.stringContaining('暂时无法确认'),
    })
  })
  it('切换 Apple 账号后立即丢弃旧账号的订阅缓存', async () => {
    const h = harness()
    expect(await h.call({ type: 'state' })).toMatchObject({ subscription: 'active' })
    h.music.isAuthorized = false
    expect(await h.call({ type: 'state' })).toMatchObject({ loggedIn: false, subscription: 'unknown' })
    h.music.hasMusicSubscription.mockResolvedValue(false)
    h.music.isAuthorized = true
    expect(await h.call({ type: 'state' })).toMatchObject({ loggedIn: true, subscription: 'inactive' })
    expect(h.music.hasMusicSubscription).toHaveBeenCalledTimes(2)
  })
  it('兼容查询缺少明确 active 字段时保持未知，不误报无订阅', async () => {
    const h = harness()
    h.music.hasMusicSubscription = undefined as unknown as typeof h.music.hasMusicSubscription
    Object.assign(h.music, { me: vi.fn(async () => ({ subscription: {} })) })
    expect(await h.call({ type: 'state' })).toMatchObject({ subscription: 'unknown' })
    await h.command('load', { id: '123' })
    expect(h.music.setQueue).not.toHaveBeenCalled()
    expect(await h.call({ type: 'state' })).toMatchObject({ error: expect.stringContaining('暂时无法确认') })
  })
  it('暂停态拖动后恢复使用新进度，旧曲目控制被忽略', async () => {
    const h = harness()
    await h.command('load', { id: '123', startAt: 20, autoplay: false })
    await h.command('seek', { seconds: 80 })
    await h.command('play')
    expect(h.music.seekToTime).toHaveBeenLastCalledWith(80)
    await h.command('pause', { playbackId: 'old' })
    expect(h.music.pause).not.toHaveBeenCalled()
  })
  it('个人库先映射目录ID，试听不报告完整播放', async () => {
    const h = harness()
    await h.command('load', { id: 'i.123', library: true })
    expect(h.music.setQueue).toHaveBeenCalledWith({ song: '456', startPlaying: false })
    h.music.currentPlaybackDuration = 30
    expect(await h.call({ type: 'state' })).toMatchObject({
      status: 'error',
      error: expect.stringContaining('完整歌曲需要有效的 Apple Music 订阅'),
    })
  })
  it('加载期间取消，迟到的队列完成不再开播', async () => {
    const h = harness()
    let finish!: (value: object) => void
    h.music.setQueue.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = h.command('load', { id: '123' })
    await vi.waitFor(() => expect(h.music.setQueue).toHaveBeenCalled())
    await h.call({ type: 'invalidate', generation: 1 })
    finish({})
    await pending
    expect(h.music.play).not.toHaveBeenCalled()
  })
  it('加载期间媒体错误不被成功覆盖，显式新播放可重试', async () => {
    const h = harness()
    let finish!: (value: object) => void
    h.music.setQueue.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = h.command('load', { id: '123' })
    await vi.waitFor(() => expect(h.music.setQueue).toHaveBeenCalled())
    h.events.error({ message: 'DRM error' })
    finish({})
    await pending
    expect(h.music.play).not.toHaveBeenCalled()
    expect(await h.call({ type: 'state' })).toMatchObject({ status: 'error', error: 'DRM error' })
    await h.command('load', { id: '456' })
    expect(await h.call({ type: 'state' })).toMatchObject({ status: 'playing' })
  })
  it('旧歌之后加载新歌期间暂停，恢复只播放新队列', async () => {
    const h = harness()
    await h.command('load', { id: 'old' })
    let finish!: (value: { data: { data: Array<{ id: string; attributes: { durationInMillis: number } }> } }) => void
    h.music.api.music.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = h.command('load', { id: 'new' })
    await vi.waitFor(() => expect(finish).toBeDefined())
    await h.call({ type: 'suspend', playbackId: 'p1' })
    finish({ data: { data: [{ id: 'new', attributes: { durationInMillis: 180000 } }] } })
    await pending
    expect(h.music.setQueue).toHaveBeenLastCalledWith({ song: 'new', startPlaying: false })
    expect(h.music.play).toHaveBeenCalledOnce()
    await h.command('pause')
    await h.command('play')
    expect(h.music.play).toHaveBeenCalledTimes(2)
  })
  it('新歌加载失败后直接play不能错播旧队列，重新加载可恢复', async () => {
    const h = harness()
    await h.command('load', { id: 'old' })
    h.music.setQueue.mockRejectedValueOnce(new Error('new song failed'))
    await h.command('load', { id: 'new' })
    await h.command('play')
    expect(h.music.play).toHaveBeenCalledOnce()
    expect(await h.call({ type: 'state' })).toMatchObject({ status: 'error' })
    await h.command('load', { id: 'new' })
    expect(h.music.play).toHaveBeenCalledTimes(2)
  })
  it('新load尚未进入网页时停止新ID，仍停止旧SDK队列且不把旧歌当作新歌恢复', async () => {
    const h = harness()
    await h.command('load', { id: 'old', playbackId: 'old' })
    expect(h.music.playbackState).toBe(2)
    await h.call({ type: 'invalidate', generation: 2 })
    await h.call({ type: 'command', generation: 1, command: { type: 'load', id: 'new', playbackId: 'new' } })
    await h.call({ type: 'command', generation: 2, command: { type: 'stop', playbackId: 'new' } })
    expect(h.music.playbackState).toBe(4)
    expect(await h.call({ type: 'state' })).toMatchObject({ playbackId: 'new', status: 'idle' })
    await h.call({ type: 'command', generation: 2, command: { type: 'play', playbackId: 'new' } })
    expect(h.music.play).toHaveBeenCalledOnce()
  })
  it('播放Promise晚于媒体错误返回，不能覆盖失败', async () => {
    const h = harness()
    let finish!: () => void
    h.music.play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = h.command('load', { id: '123' })
    await vi.waitFor(() => expect(h.music.play).toHaveBeenCalled())
    h.events.error({ message: 'license error' })
    finish()
    await pending
    expect(await h.call({ type: 'state' })).toMatchObject({ status: 'error', error: 'license error' })
    expect(h.music.playbackState).toBe(4)
  })
})
