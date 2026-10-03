import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settings'
import { useShortcutStore } from '../../stores/shortcuts'
import { ShortcutSettings } from './ShortcutSettings'
import type { HotkeyOutcome } from '../../types/ipc'

const h = vi.hoisted(() => ({ pending: false, results: [] as HotkeyOutcome[], error: '', menuAccelerators: [] as string[] }))
vi.mock('../../stores/shortcuts', () => ({ useShortcutStore: Object.assign(
  (selector: (state: typeof h) => unknown) => selector(h),
  { setState: (patch: Partial<typeof h>) => Object.assign(h, patch) }
) }))

vi.mock('../ui/Switch', () => ({ Switch: (props: { checked: boolean; 'aria-label'?: string }) => (
  <button role="switch" aria-checked={props.checked} aria-label={props['aria-label']} />
) }))

afterEach(() => {
  useShortcutStore.setState({ results: [], error: '' })
  vi.unstubAllGlobals()
})

it('设置页展示两种作用域、全部基础动作、媒体键边界和逐行注册失败', () => {
  vi.stubGlobal('window', { desktop: { platform: 'darwin' } })
  const binding = useSettingsStore.getState().hotkeys[0]
  useShortcutStore.setState({ pending: false, results: [{ ...binding, ok: false, conflict: { reason: '该组合键已被占用', sourceName: '系统', sourceIcon: 'warning' } }] })
  const html = renderToStaticMarkup(<ShortcutSettings />)
  expect(html).toContain('应用内快捷键')
  expect(html).toContain('全局快捷键')
  expect(html).toContain('迷你 / 完整模式')
  expect(html).toContain('⌘ ⌥ ⇧ 空格')
  expect(html).toContain('⌘ ⇧ P')
  expect(html).toContain('role="alert"')
  expect(html).toContain('该组合键已被占用')
  expect(html).toContain('Apple Music 的媒体键由官网会话独立管理')
})
