import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appleMusicPlayerPage } from './apple-music-page'

type Command = { type: string; sequence: number; playbackId: string; id?: string; library?: boolean; autoplay?: boolean; startAt?: number; volume?: number; seconds?: number; duration?: number; controlSequence?: number }
type Report = { status: string; playbackId: string; position: number; duration: number; subscription: string; error?: string }

async function browserHarness() {
  const elements = new Map<string, { disabled: boolean; textContent: string; onclick?: () => Promise<void> }>()
  for (const id of ['status', 'authorize', 'play', 'logout']) elements.set(id, { disabled: true, textContent: '' })
  const events: Record<string, (event?: unknown) => void> = {}
  const states = { playing: 2, paused: 3, stopped: 4, completed: 10, ended: 6, waiting: 8, stalled: 9, loading: 1, seeking: 7 }
  const reports: Report[] = []
  const auths: unknown[] = []
  let commands: Command[] = []
  let revoked = false
  let offline = false
  let ready!: () => Promise<void>
  const music = {
    isAuthorized: false, musicUserToken: '', storefrontId: 'cn', previewOnly: true,
    hasMusicSubscription: vi.fn(async () => true),
    currentPlaybackTime: 0, currentPlaybackDuration: 180, playbackState: 0, volume: 1,
    authorize: vi.fn(async () => { music.isAuthorized = true; music.musicUserToken = 'user-test'; return 'user-test' }),
    unauthorize: vi.fn(async () => { music.isAuthorized = false }),
    stop: vi.fn(async () => { music.playbackState = states.stopped; events.state?.() }),
    pause: vi.fn(async () => { music.playbackState = states.paused; events.state?.() }),
    play: vi.fn(async () => { music.playbackState = states.playing; events.state?.() }),
    seekToTime: vi.fn(async (seconds: number) => { music.currentPlaybackTime = seconds }),
    setQueue: vi.fn(async () => ({})),
    api: { music: vi.fn<(_: string) => Promise<{ data: { data: Array<{ id?: string; attributes?: { durationInMillis: number } }> } }>>(async () => ({ data: { data: [{ attributes: { durationInMillis: 180000 } }] } })) },
    addEventListener: (name: string, fn: (event?: unknown) => void) => { events[name] = fn },
  }
  const fetch = vi.fn(async (url: string, options: { body?: string }) => {
    if (offline) throw new Error('NETWORK_ERROR')
    const path = url.split('/apple-music-bridge/')[1]
    if (revoked) return { ok: false, status: 401, json: async () => ({ error: '会话已撤销' }) }
    let data: unknown = { ok: true }
    if (path === 'config') data = { developerToken: 'developer-test', storefront: 'cn' }
    if (path.startsWith('poll')) {
      const ack = Number(new URLSearchParams(path.split('?')[1]).get('ack') ?? 0)
      commands = commands.filter((command) => command.sequence > ack)
      data = { commands: [...commands] }
    }
    if (path === 'state') reports.push(JSON.parse(options.body!))
    if (path === 'auth') auths.push(JSON.parse(options.body!))
    return { ok: true, status: 200, json: async () => data }
  })
  const code = appleMusicPlayerPage.match(/<script>([\s\S]*)<\/script>/)![1]
  runInNewContext(code, {
    document: {
      getElementById: (id: string) => elements.get(id),
      addEventListener: (_: string, fn: () => Promise<void>) => { ready = fn },
      createElement: () => ({}), head: { appendChild: vi.fn() },
    },
    location: { hash: '#' + 'a'.repeat(64), pathname: '/apple-music-player' },
    history: { replaceState: vi.fn() }, fetch, setTimeout, clearTimeout, setInterval, Date,
    MusicKit: { configure: async () => music, Events: { playbackStateDidChange: 'state', mediaPlaybackError: 'error' }, PlaybackStates: states },
  })
  await ready()
  await vi.advanceTimersByTimeAsync(0)
  return {
    music, elements, reports, auths, events, states,
    authorize: () => elements.get('authorize')!.onclick!(),
    send: async (command: Command) => { if (command.type === 'load') commands = []; commands.push(command); await vi.advanceTimersByTimeAsync(701) },
    revoke: async () => { revoked = true; await vi.advanceTimersByTimeAsync(701) },
    goOffline: () => { offline = true },
  }
}

describe('浏览器 MusicKit 官方播放流程', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('成功控制才回报确认序号，旧快照与失败不能确认新操作', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    let finish!: () => void
    h.music.pause.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    await h.send({ type: 'pause', sequence: 2, playbackId: 'p1', controlSequence: 1 })
    expect(h.reports.at(-1)).toMatchObject({ controlSequence: 0 })
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.reports.at(-1)).toMatchObject({ controlSequence: 1 })
    await h.send({ type: 'play', sequence: 3, playbackId: 'p1', controlSequence: 2 })
    expect(h.reports.at(-1)).toMatchObject({ controlSequence: 2 })
    h.music.seekToTime.mockRejectedValueOnce(new Error('seek failed'))
    await h.send({ type: 'seek', seconds: 10, sequence: 4, playbackId: 'p1', controlSequence: 3 })
    expect(h.reports.at(-1)).toMatchObject({ controlSequence: 2, status: 'error' })
    await h.send({ type: 'load', id: '456', sequence: 5, playbackId: 'p2' })
    expect(h.reports.at(-1)).toMatchObject({ controlSequence: 0 })
  })

  it('已知目录时长省去详情请求，从头播放不跳转且保留试听保护', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1', duration: 180, startAt: 0 })
    expect(h.music.api.music).not.toHaveBeenCalled()
    expect(h.music.seekToTime).not.toHaveBeenCalled()
    h.music.currentPlaybackDuration = 30
    h.events.state()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.reports.at(-1)).toMatchObject({ status: 'error' })
  })

  it('资料库映射后的时长以目录为准，缺失目录时长则查询详情', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1', duration: 0 })
    expect(h.music.api.music).toHaveBeenCalledWith('v1/catalog/cn/songs/123')
    h.music.api.music.mockClear().mockResolvedValueOnce({ data: { data: [{ id: '456' }] } })
    await h.send({ type: 'load', id: 'i.123', library: true, sequence: 2, playbackId: 'p2', duration: 30 })
    expect(h.music.api.music).toHaveBeenCalledWith('v1/catalog/cn/songs/456')
    h.music.currentPlaybackDuration = 30
    h.events.state()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.reports.at(-1)).toMatchObject({ status: 'error' })
  })

  it('授权、加载、暂停、拖动、完成均同步；用户音量与断点生效', async () => {
    const h = await browserHarness()
    await h.authorize()
    expect(h.auths).toEqual([{ token: 'user-test', storefront: 'cn' }])
    expect(h.reports.at(-1)?.subscription).toBe('active')
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1', volume: .4, startAt: 12 })
    expect(h.music.setQueue).toHaveBeenCalledWith({ song: '123', startPlaying: false })
    expect(h.music.volume).toBe(.4)
    expect(h.reports.at(-1)).toMatchObject({ playbackId: 'p1', status: 'playing', position: 12, duration: 180 })
    await h.send({ type: 'pause', sequence: 2, playbackId: 'p1' })
    expect(h.reports.at(-1)?.status).toBe('paused')
    await h.send({ type: 'seek', seconds: 90, sequence: 3, playbackId: 'p1' })
    expect(h.music.seekToTime).toHaveBeenLastCalledWith(90)
    h.music.playbackState = h.states.completed
    h.events.state()
    await vi.advanceTimersByTimeAsync(701)
    expect(h.reports.at(-1)?.status).toBe('ended')
  })

  it('授权成功但无订阅时仍报告已登录，并在加载前阻止播放', async () => {
    const h = await browserHarness()
    h.music.hasMusicSubscription.mockResolvedValue(false)
    await h.authorize()
    expect(h.auths).toHaveLength(1)
    expect(h.reports.at(-1)?.subscription).toBe('inactive')
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    expect(h.music.setQueue).not.toHaveBeenCalled()
    expect(h.reports.at(-1)).toMatchObject({
      subscription: 'inactive',
      status: 'error',
      error: expect.stringContaining('没有有效的 Apple Music 订阅'),
    })
  })

  it('自动播放拦截保留暂停并可在浏览器按钮恢复', async () => {
    const h = await browserHarness()
    await h.authorize()
    h.music.play.mockRejectedValueOnce(Object.assign(new Error('autoplay denied'), { name: 'NotAllowedError' }))
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    expect(h.reports.at(-1)?.status).toBe('paused')
    expect(h.elements.get('status')!.textContent).toContain('开始播放')
    await h.elements.get('play')!.onclick!()
    expect(h.reports.at(-1)?.status).toBe('playing')
  })

  it('播放之后的 DRM 错误停止音频，后续轮询仍保留错误', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    const stops = h.music.stop.mock.calls.length
    h.events.error({ error: { message: 'DRM license expired' } })
    await vi.advanceTimersByTimeAsync(1401)
    expect(h.music.stop.mock.calls.length).toBeGreaterThan(stops)
    expect(h.music.playbackState).toBe(h.states.stopped)
    expect(h.reports.at(-1)).toMatchObject({ status: 'error', error: 'DRM license expired' })
  })

  it('播放 Promise 晚于 DRM 错误完成时保留错误，明确重试后可以恢复', async () => {
    const h = await browserHarness()
    await h.authorize()
    let finish!: () => void
    h.music.play.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    const stops = h.music.stop.mock.calls.length
    h.events.error({ error: { message: 'DRM failed during play' } })
    await vi.advanceTimersByTimeAsync(0)
    finish()
    await vi.advanceTimersByTimeAsync(1401)
    expect(h.music.stop.mock.calls.length).toBeGreaterThan(stops)
    expect(h.music.playbackState).toBe(h.states.stopped)
    expect(h.reports.at(-1)).toMatchObject({ status: 'error', error: 'DRM failed during play' })
    await h.elements.get('play')!.onclick!()
    expect(h.reports.at(-1)).toMatchObject({ status: 'playing' })
    expect(h.reports.at(-1)?.error).toBeUndefined()
  })

  it('明显短于官方时长的试听不当作完整播放', async () => {
    const h = await browserHarness()
    await h.authorize()
    h.music.currentPlaybackDuration = 30
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    expect(h.reports.at(-1)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('完整歌曲需要有效的 Apple Music 订阅'),
    })
  })

  it('撤销会话使播放停止并禁止旧页再次授权或播放', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    const stops = h.music.stop.mock.calls.length
    await h.revoke()
    const plays = h.music.play.mock.calls.length
    await h.elements.get('play')!.onclick!()
    await h.elements.get('authorize')!.onclick!()
    expect(h.music.play).toHaveBeenCalledTimes(plays)
    expect(h.music.authorize).toHaveBeenCalledOnce()
    expect(h.elements.get('play')!.disabled).toBe(true)
    expect(h.music.stop.mock.calls.length).toBeGreaterThan(stops)
    expect(h.music.playbackState).toBe(h.states.stopped)
    expect(h.music.stop.mock.calls.length).toBeLessThan(10)
  })

  it('暂停恢复的曲目先拖动再播放，应使用最新进度而非旧断点', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1', autoplay: false, startAt: 25 })
    expect(h.music.play).not.toHaveBeenCalled()
    await h.send({ type: 'seek', seconds: 70, sequence: 2, playbackId: 'p1' })
    await h.send({ type: 'play', sequence: 3, playbackId: 'p1' })
    expect(h.reports.at(-1)).toMatchObject({ status: 'playing', position: 70 })
  })

  it('个人库歌曲先映射目录 ID，没有目录版本不发起播放', async () => {
    const h = await browserHarness()
    await h.authorize()
    h.music.api.music.mockResolvedValueOnce({ data: { data: [{ id: '456' }] } })
    await h.send({ type: 'load', id: 'i.personal', library: true, sequence: 1, playbackId: 'p1' })
    expect(h.music.api.music).toHaveBeenCalledWith('v1/me/library/songs/i.personal/catalog')
    expect(h.music.setQueue).toHaveBeenCalledWith({ song: '456', startPlaying: false })
    h.music.api.music.mockResolvedValueOnce({ data: { data: [] } })
    await h.send({ type: 'load', id: 'i.uploaded', library: true, sequence: 2, playbackId: 'p2' })
    expect(h.music.play).toHaveBeenCalledOnce()
    expect(h.reports.at(-1)).toMatchObject({ status: 'error', error: expect.stringContaining('没有 Apple Music 曲库版本') })
  })

  it('旧歌曲控制不影响新歌，缓冲状态可恢复为播放', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    await h.send({ type: 'load', id: '456', sequence: 2, playbackId: 'p2' })
    await h.send({ type: 'pause', sequence: 3, playbackId: 'p1' })
    expect(h.music.pause).not.toHaveBeenCalled()
    h.music.playbackState = h.states.stalled
    h.events.state()
    await vi.advanceTimersByTimeAsync(701)
    expect(h.reports.at(-1)).toMatchObject({ status: 'loading', playbackId: 'p2' })
    h.music.playbackState = h.states.playing
    h.events.state()
    await vi.advanceTimersByTimeAsync(701)
    expect(h.reports.at(-1)?.status).toBe('playing')
  })

  it('与应用持续断线后停止播放，旧页按钮不能重新开播', async () => {
    const h = await browserHarness()
    await h.authorize()
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    const stops = h.music.stop.mock.calls.length
    h.goOffline()
    await vi.advanceTimersByTimeAsync(16001)
    const plays = h.music.play.mock.calls.length
    await h.elements.get('play')!.onclick!()
    expect(h.music.play).toHaveBeenCalledTimes(plays)
    expect(h.elements.get('play')!.disabled).toBe(true)
    expect(h.music.stop.mock.calls.length).toBeGreaterThan(stops)
    expect(h.music.playbackState).toBe(h.states.stopped)
    expect(h.music.stop.mock.calls.length).toBeLessThan(10)
  })

  it('SDK加载超时后晚到的成功不会重新开播', async () => {
    const h = await browserHarness()
    await h.authorize()
    let finish!: (value: object) => void
    h.music.setQueue.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    await vi.advanceTimersByTimeAsync(12001)
    finish({})
    await vi.advanceTimersByTimeAsync(0)
    expect(h.music.play).not.toHaveBeenCalled()
    expect(h.elements.get('status')!.textContent).toContain('超时')
    expect(h.elements.get('play')!.disabled).toBe(true)
  })

  it('旧歌曲仍在SDK加载时选择新歌，不先播放旧歌再切换', async () => {
    const h = await browserHarness()
    await h.authorize()
    let finish!: (value: object) => void
    h.music.setQueue.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    await h.send({ type: 'load', id: '456', sequence: 2, playbackId: 'p2' })
    finish({})
    await vi.advanceTimersByTimeAsync(1501)
    expect(h.music.play).toHaveBeenCalledOnce()
    expect(h.music.setQueue).toHaveBeenLastCalledWith({ song: '456', startPlaying: false })
    expect(h.reports.at(-1)).toMatchObject({ status: 'playing', playbackId: 'p2' })
  })

  it('SDK 加载期间发生媒体错误，晚到的加载成功不能自动重试播放', async () => {
    const h = await browserHarness()
    await h.authorize()
    let finish!: (value: object) => void
    h.music.setQueue.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    h.events.error({ error: { message: 'queue DRM error' } })
    await vi.advanceTimersByTimeAsync(0)
    finish({})
    await vi.advanceTimersByTimeAsync(1501)
    expect(h.music.play).not.toHaveBeenCalled()
    expect(h.reports.at(-1)).toMatchObject({ status: 'error', error: 'queue DRM error' })
    await h.send({ type: 'load', id: '456', sequence: 2, playbackId: 'p2' })
    expect(h.reports.at(-1)).toMatchObject({ status: 'playing', playbackId: 'p2' })
  })

  it('SDK加载期间暂停，加载完成不自动出声', async () => {
    const h = await browserHarness()
    await h.authorize()
    let finish!: (value: object) => void
    h.music.setQueue.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await h.send({ type: 'load', id: '123', sequence: 1, playbackId: 'p1' })
    await h.send({ type: 'pause', sequence: 2, playbackId: 'p1' })
    finish({})
    await vi.advanceTimersByTimeAsync(1501)
    expect(h.music.play).not.toHaveBeenCalled()
    expect(h.reports.at(-1)?.status).toBe('paused')
  })
})
