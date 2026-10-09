import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { openAppleMusicPlayer } from '../../lib/apple-music-playback'
import { loginMusicProvider } from '../../lib/provider-login'
import { useAppleMusicConnection, type AppleMusicAccountStatus } from '../../stores/apple-music-connection'
import { useNavigationStore } from '../../stores/navigation'
import { useProviderStore } from '../../stores/providers'
import { AvatarMenu } from './AvatarMenu'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
}))
vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../lib/apple-music-playback', () => ({ openAppleMusicPlayer: vi.fn() }))
vi.mock('../../lib/provider-login', () => ({ loginMusicProvider: vi.fn() }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))
vi.mock('../../stores/apple-music-connection', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/apple-music-connection')>()
  const store = original.useAppleMusicConnection
  return { ...original, useAppleMusicConnection: Object.assign(() => store.getState(), store) }
})
vi.mock('../../stores/providers', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/providers')>()
  const store = original.useProviderStore
  return { ...original, useProviderStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store,
  ) }
})
vi.mock('../../stores/settings', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  const store = original.useSettingsStore
  return { ...original, useSettingsStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store,
  ) }
})
vi.mock('../../stores/navigation', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/navigation')>()
  const store = original.useNavigationStore
  return { ...original, useNavigationStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store,
  ) }
})

const ready: AppleMusicAccountStatus = {
  loginMode: 'web', configured: false, ready: true, managed: false,
  connected: false, loggedIn: false, subscription: 'unknown', storefront: 'cn',
}
const providerState = useProviderStore.getState()
const navigationState = useNavigationStore.getState()
const connectionState = useAppleMusicConnection.getState()

function mount() {
  const onClose = vi.fn()
  const tree = AvatarMenu({ onClose })
  function button(label: string) {
    let found: ReactElement<{ onClick(): void; disabled: boolean }> | undefined
    function visit(node: ReactNode) {
      Children.forEach(node, child => {
        if (!isValidElement<{ children?: ReactNode; 'aria-label'?: string }>(child)) return
        if (child.type === 'button' && child.props['aria-label'] === label) found = child as typeof found
        visit(child.props.children)
      })
    }
    visit(tree)
    if (!found) throw new Error(`缺少按钮：${label}`)
    return found.props
  }
  return { button, onClose }
}

beforeEach(() => {
  vi.resetAllMocks()
  useAppleMusicConnection.setState({ account: null, phase: 'idle', message: '', error: false, statusError: false })
  useProviderStore.getState().setAccountState('apple', 'anonymous')
  useNavigationStore.setState({ currentView: 'explore', history: [], future: [] })
  vi.mocked(api.get).mockResolvedValue(ready)
  vi.mocked(api.post).mockResolvedValue(ready)
  vi.mocked(openAppleMusicPlayer).mockResolvedValue()
})
afterEach(() => {
  useProviderStore.setState(providerState, true)
  useNavigationStore.setState(navigationState, true)
  useAppleMusicConnection.setState(connectionState, true)
})

describe('头像菜单 Apple Music 直接登录', () => {
  it('点击小按钮直接打开授权，保留当前页面与菜单，授权完成后自动启用', async () => {
    const menu = mount()
    menu.button('登录Apple Music').onClick()
    await vi.waitFor(() => expect(useAppleMusicConnection.getState().phase).toBe('waiting'))
    expect(openAppleMusicPlayer).toHaveBeenCalledWith('web')
    expect(loginMusicProvider).not.toHaveBeenCalled()
    expect(useNavigationStore.getState().currentView).toBe('explore')
    expect(menu.onClose).not.toHaveBeenCalled()
    vi.mocked(api.get).mockResolvedValue({ ...ready, loggedIn: true, connected: true, subscription: 'active' })
    await useAppleMusicConnection.getState().refresh()
    expect(useProviderStore.getState().byId.apple).toMatchObject({ auth: 'authenticated', enabled: true })
    expect(mount().button('退出Apple Music').disabled).toBe(false)
  })

  it('等待授权时点击同一入口取消并恢复登录按钮', async () => {
    await useAppleMusicConnection.getState().connect()
    mount().button('取消登录Apple Music').onClick()
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/apple-music/bridge/logout', undefined))
    await vi.waitFor(() => expect(useAppleMusicConnection.getState().phase).toBe('idle'))
    expect(mount().button('登录Apple Music').disabled).toBe(false)
    expect(useNavigationStore.getState().currentView).toBe('explore')
  })

  it.each(['opening', 'disconnecting'] as const)('设置页已有 %s 操作时菜单同步禁用 Apple 按钮', phase => {
    useAppleMusicConnection.setState({ phase })
    expect(mount().button('正在处理Apple Music').disabled).toBe(true)
  })

  it('授权窗口启动失败展示实际原因并恢复可重试状态', async () => {
    vi.mocked(openAppleMusicPlayer).mockRejectedValue(new Error('Apple Music 官网加载超时，请重试'))
    mount().button('登录Apple Music').onClick()
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('Apple Music 官网加载超时，请重试'))
    expect(mount().button('登录Apple Music').disabled).toBe(false)
    expect(useNavigationStore.getState().currentView).toBe('explore')
  })

  it('已登录时退出复用连接状态机，清除账号并恢复登录入口', async () => {
    useProviderStore.getState().setAccountState('apple', 'authenticated')
    useAppleMusicConnection.setState({ account: { ...ready, loggedIn: true, connected: true, subscription: 'active' } })
    mount().button('退出Apple Music').onClick()
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/apple-music/bridge/logout', undefined))
    await vi.waitFor(() => expect(useAppleMusicConnection.getState().phase).toBe('idle'))
    expect(useAppleMusicConnection.getState().account?.loggedIn).toBe(false)
    expect(mount().button('登录Apple Music').disabled).toBe(false)
  })

  it('网易和 QQ 仍使用原有原生登录流程', async () => {
    mount().button('登录网易云').onClick()
    expect(loginMusicProvider).toHaveBeenCalledWith('netease')
    mount().button('登录QQ音乐').onClick()
    expect(loginMusicProvider).toHaveBeenCalledWith('qq')
    expect(openAppleMusicPlayer).not.toHaveBeenCalled()
  })
})
