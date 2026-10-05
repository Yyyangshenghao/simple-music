import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HotkeyBinding, HotkeyResult } from '../types/ipc'

const h = vi.hoisted(() => ({ cleanups: [] as Array<() => void>, action: vi.fn() }))
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { h.cleanups.push(effect()) } }))
vi.mock('../lib/shortcut-actions', () => ({ runShortcutAction: h.action }))
import { useSettingsStore } from '../stores/settings'
import { useShortcutStore } from '../stores/shortcuts'
import { useShortcuts } from './useShortcuts'
import { useGameModeStore } from '../stores/game-mode'

const initial = useSettingsStore.getState()
let onKeyDown: (event: KeyboardEvent) => void
let onHotkey: (payload: { action: string; source?: 'menu' }) => void
let configure: ReturnType<typeof vi.fn>
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
function key(extra: Record<string, unknown> = {}) {
  return {
    key: ' ', code: 'Space', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, defaultPrevented: false, target: { closest: () => null }, preventDefault: vi.fn(), ...extra
  } as unknown as KeyboardEvent
}
beforeEach(() => {
  useGameModeStore.setState({ enabled: false })
  useSettingsStore.setState(initial, true)
  useShortcutStore.setState({ recording: false, pending: true, results: [], error: '' })
  h.action.mockClear()
  configure = vi.fn(async (bindings: HotkeyBinding[]): Promise<HotkeyResult> => ({ ok: true, results: bindings.filter((item) => item.accelerator).map((item) => ({ ...item, ok: true })) }))
  vi.stubGlobal('window', {
    desktop: { platform: 'darwin', configureHotkeys: configure, onHotkey: (cb: typeof onHotkey) => {
      onHotkey = cb
      return vi.fn()
    } },
    addEventListener: (_name: string, cb: typeof onKeyDown) => { onKeyDown = cb }, removeEventListener: vi.fn()
  })
  vi.stubGlobal('document', { hasFocus: () => false, activeElement: null })
})
afterEach(() => {
  useGameModeStore.setState({ enabled: false })
  h.cleanups.splice(0).forEach((cleanup) => cleanup())
  useSettingsStore.setState(initial, true)
  vi.unstubAllGlobals()
})

describe('快捷键真实分发链路', () => {
  it('进入游戏模式保持已注册的全局快捷键，后台播放命令继续分发', async () => {
    useSettingsStore.setState({ globalHotkeysEnabled: true })
    useShortcuts()
    await flush()
    const calls = configure.mock.calls.length
    useGameModeStore.setState({ enabled: true })
    await flush()
    expect(configure).toHaveBeenCalledTimes(calls)
    for (const action of ['play-pause', 'prev', 'next', 'volume-up']) onHotkey({ action })
    expect(h.action.mock.calls).toEqual([['play-pause'], ['prev'], ['next'], ['volume-up']])
  })
  it('自定义设置单字符键不抢占输入框', async () => {
    useSettingsStore.setState({ localHotkeys: [{ action: 'settings', accelerator: ',' }] })
    useShortcuts()
    await flush()
    const event = key({ key: ',', code: 'Comma', target: { closest: () => ({}) } })
    onKeyDown(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.action).not.toHaveBeenCalled()
    onKeyDown(key({ key: ',', code: 'Comma' }))
    expect(h.action).toHaveBeenCalledWith('settings')
  })
  it('启动注册、空格控制、输入/输入法/按住键避让、精确匹配修饰键', async () => {
    useShortcuts()
    await flush()
    expect(configure).toHaveBeenCalledWith(initial.hotkeys, false, 'CommandOrControl+,')
    onKeyDown(key())
    expect(h.action).toHaveBeenCalledWith('play-pause')
    h.action.mockClear()
    onKeyDown(key({ target: { closest: () => ({}) } }))
    onKeyDown(key({ isComposing: true }))
    onKeyDown(key({ repeat: true }))
    onKeyDown(key({ shiftKey: true }))
    expect(h.action).not.toHaveBeenCalled()
  })
  it('录入暂停全局与本地分发；退出录入恢复；关闭开关注销', async () => {
    useShortcuts()
    await flush()
    useShortcutStore.getState().setRecording(true)
    await flush()
    expect(configure).toHaveBeenLastCalledWith([], true, 'CommandOrControl+,')
    onHotkey({ action: 'play-pause' })
    onKeyDown(key())
    expect(h.action).not.toHaveBeenCalled()
    useShortcutStore.getState().setRecording(false)
    await flush()
    expect(configure).toHaveBeenLastCalledWith(initial.hotkeys, false, 'CommandOrControl+,')
    useSettingsStore.getState().setGlobalHotkeysEnabled(false)
    await flush()
    expect(configure).toHaveBeenLastCalledWith([], false, 'CommandOrControl+,')
    onHotkey({ action: 'play-pause' })
    expect(h.action).not.toHaveBeenCalled()
  })
  it('相同本地和全局绑定在注册回复前也只执行一次，失败后本地键可用', async () => {
    let resolve!: (value: HotkeyResult) => void
    configure.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    useSettingsStore.getState().setLocalHotkeys([{ action: 'play-pause', accelerator: 'Command+Alt+Shift+Space' }])
    useShortcuts()
    const event = key({ metaKey: true, altKey: true, shiftKey: true })
    onKeyDown(event)
    onHotkey({ action: 'play-pause' })
    expect(h.action).toHaveBeenCalledTimes(1)
    h.action.mockClear()
    resolve({ ok: true, results: [{ action: 'play-pause', accelerator: 'Command+Alt+Shift+Space', ok: false }] })
    await flush()
    onKeyDown(event)
    expect(h.action).toHaveBeenCalledTimes(1)
  })
  it('丢弃旧注册回复，卸载后释放快捷键', async () => {
    let resolve!: (value: HotkeyResult) => void
    configure.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    useShortcuts()
    useSettingsStore.getState().setHotkeys([{ action: 'next', accelerator: 'F8' }])
    await flush()
    resolve({ ok: true, results: [{ action: 'prev', accelerator: 'F7', ok: true }] })
    await flush()
    expect(useShortcutStore.getState().results).toEqual([{ action: 'next', accelerator: 'F8', ok: true }])
    h.cleanups.pop()?.()
    expect(configure).toHaveBeenLastCalledWith([])
  })
  it('旧设置中的系统组合不会拦截系统行为，新的迷你模式按键可用', async () => {
    useSettingsStore.setState({
      localHotkeys: [{ action: 'mini-player', accelerator: 'Command+M' }],
      hotkeys: [{ action: 'mini-player', accelerator: 'Command+M' }]
    })
    useShortcuts()
    const reserved = key({ key: 'm', code: 'KeyM', metaKey: true })
    onKeyDown(reserved)
    expect(reserved.preventDefault).not.toHaveBeenCalled()
    expect(h.action).not.toHaveBeenCalled()
    await flush()
    onKeyDown(reserved)
    expect(reserved.preventDefault).not.toHaveBeenCalled()
    useSettingsStore.getState().setLocalHotkeys([{ action: 'mini-player', accelerator: 'CommandOrControl+Shift+P' }])
    onKeyDown(key({ key: 'P', code: 'KeyP', metaKey: true, shiftKey: true }))
    expect(h.action).toHaveBeenCalledWith('mini-player')
  })
  it.each(['darwin', 'win32'])('%s 使用对应修饰键打开设置，菜单不依赖全局开关且不重复分发', async (platform) => {
    window.desktop!.platform = platform as 'darwin' | 'win32'
    useSettingsStore.setState({ globalHotkeysEnabled: false })
    useShortcuts()
    await flush()
    const event = key({ key: '，', code: 'Comma', metaKey: platform === 'darwin', ctrlKey: platform === 'win32', target: { closest: () => ({}) } })
    onKeyDown(event)
    expect(h.action).toHaveBeenCalledOnce()
    expect(h.action).toHaveBeenCalledWith('settings')
    h.action.mockClear()
    useShortcutStore.setState({ menuAccelerators: [platform === 'darwin' ? 'Command+,' : 'Control+,'] })
    const menuEvent = key({ key: ',', code: 'Comma', metaKey: platform === 'darwin', ctrlKey: platform === 'win32' })
    onKeyDown(menuEvent)
    expect(menuEvent.preventDefault).not.toHaveBeenCalled()
    expect(h.action).not.toHaveBeenCalled()
    onHotkey({ action: 'settings', source: 'menu' })
    expect(h.action).toHaveBeenCalledOnce()
    useShortcutStore.getState().setRecording(true)
    onHotkey({ action: 'settings', source: 'menu' })
    expect(h.action).toHaveBeenCalledOnce()
  })
})
