import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { openAppleMusicPlayer } from '../lib/apple-music-playback'
import { useAppleMusicConnection, type AppleMusicAccountStatus } from './apple-music-connection'
import { useProviderStore } from './providers'

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../lib/apple-music-playback', () => ({ openAppleMusicPlayer: vi.fn() }))
const ready: AppleMusicAccountStatus = { loginMode: 'web', configured: false, ready: true, managed: false, connected: false, loggedIn: false, subscription: 'unknown', storefront: 'cn' }
const connected = { ...ready, loggedIn: true, connected: true, subscription: 'active' as const }
const connection = () => useAppleMusicConnection.getState()

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  useAppleMusicConnection.setState({ account: null, phase: 'idle', error: false, statusError: false, message: '' })
  useProviderStore.getState().setAccountState('apple', 'anonymous')
  vi.mocked(api.get).mockResolvedValue(ready)
  vi.mocked(api.post).mockResolvedValue(ready)
  vi.mocked(openAppleMusicPlayer).mockResolvedValue()
})
afterEach(() => vi.useRealTimers())

describe('Apple Music 登录流程', () => {
  it('授权窗口已失败时立即恢复登录按钮并显示原因', async () => {
    await connection().connect()
    vi.mocked(api.get).mockResolvedValue({ ...ready, error: 'Apple Music 官网加载超时，请重试' })
    await connection().refresh()
    expect(connection()).toMatchObject({ phase: 'idle', error: true, message: 'Apple Music 官网加载超时，请重试' })
  })
  it('直接登录无需提交开发者配置，授权完成后自动启用音源', async () => {
    await connection().connect()
    expect(api.post).not.toHaveBeenCalled()
    expect(openAppleMusicPlayer).toHaveBeenCalledWith('web')
    expect(connection().phase).toBe('waiting')
    expect(connection().message).toContain('登录成功后即可播放')
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    expect(connection().phase).toBe('idle')
    expect(connection().message).toContain('订阅有效')
    expect(useProviderStore.getState().byId.apple).toMatchObject({ auth: 'authenticated', enabled: true, playbackAvailable: true })
  })
  it('登录成功但无订阅时明确告知并保持 Apple 音源禁用', async () => {
    await connection().connect()
    vi.mocked(api.get).mockResolvedValue({ ...connected, subscription: 'inactive' })
    await connection().refresh()
    expect(connection()).toMatchObject({ phase: 'idle', error: true })
    expect(connection().message).toContain('没有有效的 Apple Music 订阅')
    expect(useProviderStore.getState().byId.apple).toMatchObject({
      auth: 'authenticated',
      enabled: false,
      playbackAvailable: false,
      lastError: expect.stringContaining('无法播放完整歌曲'),
    })
  })
  it('订阅暂时无法确认时继续等待且不误报无订阅或启用音源', async () => {
    await connection().connect()
    vi.mocked(api.get).mockResolvedValue({ ...connected, subscription: 'unknown' })
    await connection().refresh()
    expect(connection()).toMatchObject({ phase: 'waiting', error: false })
    expect(connection().message).toContain('正在确认')
    expect(connection().message).not.toContain('没有有效')
    expect(useProviderStore.getState().byId.apple).toMatchObject({ enabled: false, playbackAvailable: false })
  })
  it('普通状态同步不重新开启用户已关闭的音源', async () => {
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple.enabled).toBe(false)
  })
  it('播放器断开但账号仍登录时暂停音源，重连后恢复原启用选择', async () => {
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    useProviderStore.getState().setEnabled('apple', true)
    vi.mocked(api.get).mockResolvedValue({ ...connected, connected: false, error: 'Apple Music 播放连接已断开，请重新连接' })
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple).toMatchObject({ enabled: true, playbackAvailable: false })
    expect(connection()).toMatchObject({ error: true, message: 'Apple Music 播放连接已断开，请重新连接' })
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple).toMatchObject({ enabled: true, playbackAvailable: true })
    expect(connection().error).toBe(false)
  })
  it('启动时 Apple 会话仍在恢复，不把已保存的启用偏好写成关闭', async () => {
    useProviderStore.setState(state => ({ byId: {
      ...state.byId,
      apple: { enabled: true, auth: 'unknown' },
    } }))
    vi.mocked(api.get).mockResolvedValueOnce({ ...ready, restoring: true })
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple).toMatchObject({ enabled: true, auth: 'unknown' })
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple).toMatchObject({ enabled: true, auth: 'authenticated', playbackAvailable: true })
  })
  it('静默恢复超时后暂未登录仍保留启用偏好，迟到的有效授权会恢复音源', async () => {
    useProviderStore.setState(state => ({ byId: {
      ...state.byId,
      apple: { enabled: true, auth: 'unknown' },
    } }))
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple).toMatchObject({ enabled: true, auth: 'anonymous' })
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple).toMatchObject({ enabled: true, auth: 'authenticated', playbackAvailable: true })
  })
  it('暂时失联后用户主动退出会清除保留的启用偏好', async () => {
    useProviderStore.setState(state => ({ byId: {
      ...state.byId,
      apple: { enabled: true, auth: 'unknown' },
    } }))
    await connection().refresh()
    expect(useProviderStore.getState().byId.apple.enabled).toBe(true)
    await connection().disconnect()
    expect(useProviderStore.getState().byId.apple.enabled).toBe(false)
  })
  it('旧账号仍有效但新窗口没有授权时，不误报登录完成', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, loggedIn: true })
    await connection().connect()
    expect(connection().phase).toBe('waiting')
    expect(useProviderStore.getState().byId.apple.enabled).toBe(false)
  })
  it('保存和打开合为一次操作，保存失败不打开浏览器', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('令牌无效'))
    await connection().connect({ developerToken: 'invalid', storefront: 'cn' })
    expect(openAppleMusicPlayer).not.toHaveBeenCalled()
    expect(connection()).toMatchObject({ phase: 'idle', error: true, message: '令牌无效' })
    await connection().connect({ developerToken: 'valid', storefront: 'cn' })
    expect(openAppleMusicPlayer).toHaveBeenCalledOnce()
    expect(openAppleMusicPlayer).toHaveBeenCalledWith('developer')
    expect(connection().phase).toBe('waiting')
  })
  it('连续点击不会重复创建播放窗口', async () => {
    await Promise.all([connection().connect(), connection().connect()])
    expect(openAppleMusicPlayer).toHaveBeenCalledOnce()
  })
  it('打开失败可重试且不进入等待状态', async () => {
    vi.mocked(openAppleMusicPlayer).mockRejectedValueOnce(new Error('打开失败'))
    await connection().connect()
    expect(connection()).toMatchObject({ phase: 'idle', error: true, message: '打开失败' })
    await connection().connect()
    expect(connection().phase).toBe('waiting')
  })
  it.each([false, true])('授权等待超时后恢复操作入口（网络失败：%s）', async offline => {
    await connection().connect()
    await vi.advanceTimersByTimeAsync(120001)
    if (offline) vi.mocked(api.get).mockRejectedValue(new Error('offline'))
    await connection().refresh()
    expect(connection()).toMatchObject({ phase: 'idle', error: true })
    expect(useProviderStore.getState().byId.apple.enabled).toBe(false)
  })
  it('取消登录撤销服务端会话，取消前发出的状态不能恢复登录', async () => {
    await connection().connect()
    let finish!: (status: AppleMusicAccountStatus) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = connection().refresh()
    await connection().disconnect()
    finish(connected)
    await pending
    expect(api.post).toHaveBeenCalledWith('/api/apple-music/bridge/logout', undefined)
    expect(connection().phase).toBe('idle')
    expect(connection().account?.loggedIn).toBe(false)
    expect(useProviderStore.getState().byId.apple.enabled).toBe(false)
  })
  it('晚到的旧状态不覆盖较新的状态', async () => {
    let finish!: (status: AppleMusicAccountStatus) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const old = connection().refresh()
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    finish(ready)
    await old
    expect(connection().account).toEqual(connected)
  })
  it('首次读取失败后成功重试会清除读取错误', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
    await connection().refresh()
    expect(connection().error).toBe(true)
    await connection().refresh()
    expect(connection()).toMatchObject({ account: ready, error: false, message: '' })
  })
  it('打开窗口期间的周期刷新失败不污染等待提示', async () => {
    let finish!: () => void
    vi.mocked(openAppleMusicPlayer).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const opening = connection().connect()
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
    await connection().refresh()
    finish()
    await opening
    expect(connection()).toMatchObject({ phase: 'waiting', error: false })
  })
  it('令牌过期时终止等待并显示服务不可用', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, loginMode: 'developer', ready: false })
    await connection().connect()
    expect(connection()).toMatchObject({ phase: 'idle', error: true })
    expect(connection().message).toContain('暂不可用')
  })
  it('官网模式不会被缺少或过期的开发者配置中断', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, ready: false, configured: false })
    await connection().connect()
    expect(openAppleMusicPlayer).toHaveBeenCalledWith('web')
    expect(connection()).toMatchObject({ phase: 'waiting', error: false })
    vi.mocked(api.get).mockResolvedValue(connected)
    await connection().refresh()
    expect(connection()).toMatchObject({ phase: 'idle', error: false })
    expect(useProviderStore.getState().byId.apple.enabled).toBe(true)
  })
})
