import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HotkeyBinding, HotkeyResult } from '../types/ipc'

const h = vi.hoisted(() => ({ cleanups: [] as Array<() => void>, action: vi.fn() }))
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { h.cleanups.push(effect()) } }))
vi.mock('../lib/shortcut-actions', () => ({ runShortcutAction: h.action }))
import { useSettingsStore } from '../stores/settings'
import { useShortcutStore } from '../stores/shortcuts'
import { useShortcuts } from './useShortcuts'
import { initGlobalShortcuts } from '../lib/global-shortcuts'
import { useGameModeStore } from '../stores/game-mode'
import { useShuangeStore } from '../stores/shuange'

const initial = useSettingsStore.getState()
let onKeyDown: (event: KeyboardEvent) => void
let onKeyDownCapture: ((event: KeyboardEvent) => void) | undefined
let onHotkey: (payload: { action: string; source?: 'menu' }) => void
let configure: ReturnType<typeof vi.fn>
let stopGlobal: (() => void) | undefined
function mountShortcuts() {
  stopGlobal = initGlobalShortcuts()
  useShortcuts()
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
function key(extra: Record<string, unknown> = {}) {
  return {
    key: ' ', code: 'Space', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, defaultPrevented: false, cancelBubble: false, target: { closest: () => null },
    preventDefault: vi.fn(function (this: KeyboardEvent) { Object.defineProperty(this, 'defaultPrevented', { value: true }) }),
    stopPropagation: vi.fn(function (this: KeyboardEvent) { this.cancelBubble = true }), ...extra
  } as unknown as KeyboardEvent
}
function target(selector: string) {
  return { closest: (selectors: string) => selectors.split(', ').includes(selector) ? {} : null }
}
function dispatch(event: KeyboardEvent, control = vi.fn()) {
  onKeyDownCapture?.(event)
  if (!event.cancelBubble) {
    control(event)
    onKeyDown(event)
  }
  return control
}
beforeEach(() => {
  useGameModeStore.setState({ enabled: false })
  useShuangeStore.setState({ active: false })
  useSettingsStore.setState(initial, true)
  useShortcutStore.setState({ recording: false, pending: true, results: [], error: '' })
  h.action.mockClear()
  configure = vi.fn(async (bindings: HotkeyBinding[]): Promise<HotkeyResult> => ({ ok: true, results: bindings.filter((item) => item.accelerator).map((item) => ({ ...item, ok: true })) }))
  vi.stubGlobal('window', {
    desktop: { platform: 'darwin', configureHotkeys: configure, onHotkey: (cb: typeof onHotkey) => {
      onHotkey = cb
      return vi.fn()
    } },
    addEventListener: (_name: string, cb: typeof onKeyDown, capture?: boolean) => {
      if (capture) onKeyDownCapture = cb
      else onKeyDown = cb
    }, removeEventListener: vi.fn()
  })
  vi.stubGlobal('document', { hasFocus: () => false, activeElement: null })
})
afterEach(() => {
  useGameModeStore.setState({ enabled: false })
  useShuangeStore.setState({ active: false })
  onKeyDownCapture = undefined
  h.cleanups.splice(0).forEach((cleanup) => cleanup())
  stopGlobal?.()
  stopGlobal = undefined
  useSettingsStore.setState(initial, true)
  vi.unstubAllGlobals()
})

describe('快捷键真实分发链路', () => {
  it('应用内监听只处理当前窗口按键，不注册或释放全局快捷键', () => {
    useShortcuts()
    onKeyDown(key())
    expect(h.action).toHaveBeenCalledWith('play-pause')
    h.cleanups.pop()?.()
    expect(configure).not.toHaveBeenCalled()
  })

  it('无需挂载界面即可接收全局命令；重复启动不重复注册，停止后旧回调无效', async () => {
    let resolve!: (value: HotkeyResult) => void
    configure.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    stopGlobal = initGlobalShortcuts()
    expect(initGlobalShortcuts()).toBe(stopGlobal)
    expect(configure).toHaveBeenCalledOnce()
    onHotkey({ action: 'next' })
    expect(h.action).toHaveBeenCalledOnce()
    stopGlobal()
    const stopped = useShortcutStore.getState()
    onHotkey({ action: 'prev' })
    resolve({ ok: true, results: [{ action: 'next', accelerator: 'F8', ok: true }] })
    await flush()
    expect(h.action).toHaveBeenCalledOnce()
    expect(useShortcutStore.getState()).toBe(stopped)
    const registrations = configure.mock.calls.length
    useSettingsStore.setState({ globalHotkeysEnabled: false })
    useShortcutStore.setState({ recording: true })
    stopGlobal()
    expect(configure).toHaveBeenCalledTimes(registrations)
  })

  it('卸载主窗口按键监听不注销宿主持有的全局快捷键', async () => {
    mountShortcuts()
    await flush()
    const registrations = configure.mock.calls.length
    h.cleanups.pop()?.()
    expect(configure).toHaveBeenCalledTimes(registrations)
    onHotkey({ action: 'next' })
    expect(h.action).toHaveBeenCalledWith('next')
  })

  it('模态对话框不接受键盘导航或激活，也不穿透本地和菜单命令', async () => {
    vi.stubGlobal('document', { hasFocus: () => true, activeElement: null, querySelector: (selector: string) => selector === 'dialog[open]' ? {} : null })
    useSettingsStore.setState({ localHotkeys: [
      { action: 'play-pause', accelerator: 'Space' }, { action: 'next', accelerator: 'Tab' },
      { action: 'settings', accelerator: 'Escape' },
    ] })
    mountShortcuts()
    await flush()
    for (const pressed of [' ', 'Tab', 'Escape']) {
      const event = key({ key: pressed, code: pressed === ' ' ? 'Space' : pressed, target: target('button') })
      expect(dispatch(event)).not.toHaveBeenCalled()
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    onHotkey({ action: 'settings', source: 'menu' })
    onHotkey({ action: 'play-pause' })
    expect(h.action).not.toHaveBeenCalled()
  })
  it('进入游戏模式保持已注册的全局快捷键，后台播放命令继续分发', async () => {
    useSettingsStore.setState({ globalHotkeysEnabled: true })
    mountShortcuts()
    await flush()
    const calls = configure.mock.calls.length
    useGameModeStore.setState({ enabled: true })
    await flush()
    expect(configure).toHaveBeenCalledTimes(calls)
    for (const action of ['play-pause', 'prev', 'next', 'volume-up']) onHotkey({ action })
    expect(h.action.mock.calls).toEqual([['play-pause'], ['prev'], ['next'], ['volume-up']])
  })
  it.each(['button', 'summary', '[role="button"]'])('Enter 绑定优先于聚焦 %s 的默认激活', async (selector) => {
    useSettingsStore.setState({ localHotkeys: [{ action: 'play-pause', accelerator: 'Enter' }] })
    mountShortcuts()
    await flush()
    const event = key({ key: 'Enter', code: 'Enter', target: target(selector) })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(h.action.mock.calls).toEqual([['play-pause']])
  })
  it.each(['Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'f', 'l'])('未绑定的 %s 不激活按钮、滚动页面或触发页面操作', async (pressed) => {
    useSettingsStore.setState({ localHotkeys: [] })
    mountShortcuts()
    await flush()
    const event = key({ key: pressed, code: pressed, target: target('button') })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(h.action).not.toHaveBeenCalled()
  })
  it.each(['input[type="range"]', 'input[type="checkbox"]', 'input[type="radio"]', 'select'])('%s 不抢占方向键或空格快捷键', async (selector) => {
    useSettingsStore.setState({ localHotkeys: [{ action: 'next', accelerator: 'Right' }, { action: 'play-pause', accelerator: 'Space' }] })
    mountShortcuts()
    await flush()
    for (const pressed of ['ArrowRight', ' ']) {
      const event = key({ key: pressed, code: pressed === ' ' ? 'Space' : pressed, target: target(selector) })
      expect(dispatch(event)).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(true)
    }
    expect(h.action.mock.calls).toEqual([['next'], ['play-pause']])
  })

  it.each([false, true])('Tab（Shift=%s）不会进入控件或离开输入框', async (shiftKey) => {
    mountShortcuts()
    await flush()
    for (const selector of ['button', 'input']) {
      const event = key({ key: 'Tab', code: 'Tab', shiftKey, target: target(selector) })
      expect(dispatch(event)).not.toHaveBeenCalled()
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    expect(h.action).not.toHaveBeenCalled()
  })
  it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])('%s 不会切换聚焦的菜单或音源选项', async (arrow) => {
    mountShortcuts()
    await flush()
    const event = key({ key: arrow, code: arrow, target: target('button') })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.action).not.toHaveBeenCalled()
  })
  it.each(['button', 'summary', '[role="button"]', '[role="switch"]'])('聚焦 %s 后，空格只控制播放，不触发控件', async (selector) => {
    mountShortcuts()
    await flush()
    const event = key({ target: target(selector) })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.action.mock.calls).toEqual([['play-pause']])
    const repeated = key({ repeat: true, target: target(selector) })
    expect(dispatch(repeated)).not.toHaveBeenCalled()
    expect(h.action).toHaveBeenCalledOnce()
  })
  it('清除空格绑定后，空格也不会激活按钮', async () => {
    useSettingsStore.setState({ localHotkeys: [] })
    mountShortcuts()
    await flush()
    const event = key({ target: target('button') })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.action).not.toHaveBeenCalled()
  })
  it.each([
    ['Tab', false, 'Tab'], ['Tab', true, 'Shift+Tab'],
    ['ArrowLeft', false, 'Left'], ['ArrowLeft', true, 'Shift+Left'],
  ])('自定义 %s（Shift=%s）仍执行一次，且不导航控件', async (pressed, shiftKey, accelerator) => {
    useSettingsStore.setState({ localHotkeys: [{ action: 'next', accelerator: String(accelerator) }] })
    mountShortcuts()
    await flush()
    const event = key({ key: pressed, code: pressed, shiftKey, target: target('button') })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(h.action.mock.calls).toEqual([['next']])
  })
  it('空格绑定为设置菜单快捷键时仍执行一次，不激活聚焦按钮', async () => {
    useSettingsStore.setState({ localHotkeys: [{ action: 'settings', accelerator: 'Space' }] })
    mountShortcuts()
    await flush()
    useShortcutStore.setState({ menuAccelerators: ['Space'] })
    const event = key({ target: target('button') })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(h.action.mock.calls).toEqual([['settings']])
  })
  it('非输入区的空格不会触发多选处理或页面快捷键，全局同键不重复执行', async () => {
    useSettingsStore.setState({ hotkeys: [{ action: 'play-pause', accelerator: 'Space' }] })
    mountShortcuts()
    await flush()
    const event = key()
    expect(dispatch(event)).not.toHaveBeenCalled()
    onHotkey({ action: 'play-pause' })
    expect(h.action.mock.calls).toEqual([['play-pause']])
  })
  it('文字输入区保留空格、方向键行为，快捷键录入保留 Tab', async () => {
    mountShortcuts()
    await flush()
    for (const selector of ['input:not([type])', 'input[type="text"]', 'input[type="search"]', 'textarea', '[contenteditable]:not([contenteditable="false"])']) {
      for (const pressed of [' ', 'ArrowLeft']) {
        const event = key({ key: pressed, code: pressed === ' ' ? 'Space' : pressed, target: target(selector) })
        expect(dispatch(event)).toHaveBeenCalledOnce()
        expect(event.preventDefault).not.toHaveBeenCalled()
      }
    }
    useShortcutStore.setState({ recording: true })
    const recording = key({ key: 'Tab', code: 'Tab', target: target('button') })
    expect(dispatch(recording)).toHaveBeenCalledOnce()
    expect(recording.preventDefault).not.toHaveBeenCalled()
    expect(h.action).not.toHaveBeenCalled()
  })
  it('库分类控件也不接受未绑定方向键导航', async () => {
    mountShortcuts()
    await flush()
    const event = key({ key: 'ArrowRight', code: 'ArrowRight', target: target('[data-arrow-navigation]') })
    const control = vi.fn((event: KeyboardEvent) => event.preventDefault())
    expect(dispatch(event, control)).not.toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(h.action).not.toHaveBeenCalled()
  })
  it('库分类仍执行用户配置的 Shift 方向键快捷键', async () => {
    useSettingsStore.setState({ localHotkeys: [{ action: 'next', accelerator: 'Shift+Left' }] })
    mountShortcuts()
    await flush()
    const event = key({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true, target: target('[data-arrow-navigation]') })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(h.action.mock.calls).toEqual([['next']])
  })
  it('保留系统切换窗口和修饰键切歌，不交给普通控件', async () => {
    mountShortcuts()
    await flush()
    const system = key({ key: 'Tab', code: 'Tab', metaKey: true })
    expect(dispatch(system)).toHaveBeenCalledOnce()
    expect(system.preventDefault).not.toHaveBeenCalled()
    expect(dispatch(key({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true, target: target('button') }))).not.toHaveBeenCalled()
    expect(h.action.mock.calls).toEqual([['next']])
  })
  it('爽歌页面也不接受未配置的上下方向键', async () => {
    useShuangeStore.setState({ active: true })
    mountShortcuts()
    await flush()
    expect(dispatch(key({ key: 'ArrowDown', code: 'ArrowDown' }))).not.toHaveBeenCalled()
    expect(dispatch(key({ key: 'ArrowUp', code: 'ArrowUp' }))).not.toHaveBeenCalled()
    expect(dispatch(key({ key: 'ArrowRight', code: 'ArrowRight' }))).not.toHaveBeenCalled()
    expect(h.action).not.toHaveBeenCalled()
  })
  it('爽歌上下方向键绑定过其他动作时，用户配置优先于页面切换', async () => {
    useShuangeStore.setState({ active: true })
    useSettingsStore.setState({ localHotkeys: [{ action: 'like', accelerator: 'Down' }] })
    mountShortcuts()
    await flush()
    const event = key({ key: 'ArrowDown', code: 'ArrowDown', target: target('button') })
    expect(dispatch(event)).not.toHaveBeenCalled()
    expect(h.action.mock.calls).toEqual([['like']])
  })

  it('自定义设置单字符键不抢占输入框', async () => {
    useSettingsStore.setState({ localHotkeys: [{ action: 'settings', accelerator: ',' }] })
    mountShortcuts()
    await flush()
    const event = key({ key: ',', code: 'Comma', target: { closest: () => ({}) } })
    onKeyDown(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.action).not.toHaveBeenCalled()
    onKeyDown(key({ key: ',', code: 'Comma' }))
    expect(h.action).toHaveBeenCalledWith('settings')
  })
  it('启动注册、空格控制、输入/输入法/按住键避让、精确匹配修饰键', async () => {
    mountShortcuts()
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
    mountShortcuts()
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
    mountShortcuts()
    const event = key({ metaKey: true, altKey: true, shiftKey: true })
    onKeyDown(event)
    onHotkey({ action: 'play-pause' })
    expect(h.action).toHaveBeenCalledTimes(1)
    h.action.mockClear()
    resolve({ ok: true, results: [{ action: 'play-pause', accelerator: 'Command+Alt+Shift+Space', ok: false }] })
    await flush()
    onKeyDown(key({ metaKey: true, altKey: true, shiftKey: true }))
    expect(h.action).toHaveBeenCalledTimes(1)
  })
  it('丢弃旧注册回复，宿主停止后释放快捷键', async () => {
    let resolve!: (value: HotkeyResult) => void
    configure.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    mountShortcuts()
    useSettingsStore.getState().setHotkeys([{ action: 'next', accelerator: 'F8' }])
    await flush()
    resolve({ ok: true, results: [{ action: 'prev', accelerator: 'F7', ok: true }] })
    await flush()
    expect(useShortcutStore.getState().results).toEqual([{ action: 'next', accelerator: 'F8', ok: true }])
    stopGlobal?.()
    expect(configure).toHaveBeenLastCalledWith([])
  })
  it('旧设置中的系统组合不会拦截系统行为，新的迷你模式按键可用', async () => {
    useSettingsStore.setState({
      localHotkeys: [{ action: 'mini-player', accelerator: 'Command+M' }],
      hotkeys: [{ action: 'mini-player', accelerator: 'Command+M' }]
    })
    mountShortcuts()
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
    mountShortcuts()
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
