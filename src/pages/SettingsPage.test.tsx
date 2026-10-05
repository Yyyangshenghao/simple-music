import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settings'
import { useVisualStore } from '../stores/visual'
import { useUpdateStore } from '../stores/update'
import { version } from '../../package.json'
import { SettingsPage } from './SettingsPage'

vi.mock('../stores/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/settings')>()
  const store = original.useSettingsStore
  return { ...original, useSettingsStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store
  ) }
})
vi.mock('../stores/visual', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/visual')>()
  const store = original.useVisualStore
  return { ...original, useVisualStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store
  ) }
})
vi.mock('../components/ui/SystemFontPicker', () => ({
  SystemFontPicker: (props: { value: string; ariaLabel: string }) => <button aria-label={props.ariaLabel}>{props.value || '跟随界面'}</button>
}))
vi.mock('../stores/update', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/update')>()
  const store = original.useUpdateStore
  return { ...original, useUpdateStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store
  ) }
})
vi.mock('../components/Settings/DesktopLyricsSettings', () => ({ DesktopLyricsSettings: () => <section>桌面歌词显示设置</section> }))
vi.mock('../components/Settings/AppleMusicSettings', () => ({ AppleMusicSettings: () => null }))
vi.mock('../components/Settings/ShortcutSettings', () => ({ ShortcutSettings: () => null }))

const initialSettings = useSettingsStore.getState()
const initialVisual = useVisualStore.getState()
const initialUpdate = useUpdateStore.getState()

beforeEach(() => {
  vi.stubGlobal('window', { desktop: { platform: 'darwin' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useSettingsStore.setState((state) => ({ performance: { ...state.performance, lyrics3dEnabled: false } }))
  useVisualStore.setState((state) => ({ fx: { ...state.fx, desktopLyricsFontFamily: 'Helvetica Neue', desktopLyricsFontFamilyCjk: 'Songti SC' } }))
})
afterEach(() => {
  useSettingsStore.setState(initialSettings, true)
  useVisualStore.setState(initialVisual, true)
  useUpdateStore.setState(initialUpdate, true)
  vi.unstubAllGlobals()
})

describe('关于应用的更新日志', () => {
  it('未检查更新时使用应用版本，只显示日志按钮而不铺开版本记录', () => {
    useUpdateStore.setState({ info: null, checking: false })
    const html = renderToStaticMarkup(<SettingsPage />)
    const about = html.slice(html.indexOf('<section id="settings-section-about"'))
    expect(about).toContain(`v${version}`)
    expect(about).toContain('尚未检查')
    expect(about).toContain('检查更新')
    expect(about).toContain('更新日志')
    expect(about).toMatch(/<button[^>]*>更新日志<\/button>/)
    expect(about).not.toContain('<details')
    expect(about).not.toContain('v2.0.0')
  })

  it.each([true, false])('检查更新状态为 %s 时日志入口保持可用', (checking) => {
    useUpdateStore.setState({ checking, info: {
      configured: true, preview: false, updateAvailable: true,
      currentVersion: version, latestVersion: '2.3.1',
      release: { tagName: 'v2.3.1', version: '2.3.1', name: 'Simple Music', htmlUrl: '', downloadUrl: '', summary: '', notes: [] },
    } })
    const html = renderToStaticMarkup(<SettingsPage />)
    const about = html.slice(html.indexOf('<section id="settings-section-about"'))
    expect(about).toContain(checking ? '检查中…' : '发现新版本 v2.3.1')
    expect(about).toContain('下载更新')
    expect(about).toMatch(/<button[^>]*>更新日志<\/button>/)
    expect(about).not.toContain('<details')
  })
})

function lyricsMarkup(): string {
  const html = renderToStaticMarkup(<SettingsPage />)
  return html.slice(html.indexOf('<section id="settings-section-lyrics"'), html.indexOf('<section id="settings-section-cache"'))
}

describe('歌词设置分组', () => {
  it('字体合并到独立卡片，桌面和 3D 字体在禁用详情之外仍可选择', () => {
    const html = lyricsMarkup()
    const [beforeDetails] = html.split('<fieldset')
    expect(beforeDetails).toContain('aria-label="桌面歌词西文字体"')
    expect(beforeDetails).toContain('aria-label="桌面歌词中文字体"')
    expect(beforeDetails).toContain('aria-label="普通歌词西文字体"')
    expect(beforeDetails).toContain('aria-label="3D 歌词中文字体"')
    expect(beforeDetails).toContain('Helvetica Neue')
    expect(beforeDetails).toContain('Songti SC')
    expect(beforeDetails).not.toContain('disabled=""')
    expect(beforeDetails).not.toContain('aria-expanded=')
  })

  it('关闭舞台时保留所有详细控件，并以原生 fieldset 禁用', () => {
    const html = lyricsMarkup()
    expect(html).toMatch(/<fieldset[^>]*id="settings-lyrics3d-details"[^>]*disabled=""/)
    const details = html.slice(html.indexOf('<fieldset'))
    expect(details).toContain('<legend>3D 歌词详细设置</legend>')
    expect(details).toContain('背景场景')
    expect(details).toContain('文字演出')
    expect(details).toContain('粒子数量')
    expect(details).toContain('渲染分辨率')
    expect(details).toContain('type="range"')
    expect(details).toContain('恢复默认')
    expect(details).not.toContain('hidden=')
    expect(details).not.toContain('role="button"')
  })

  it('重新开启舞台仅解除禁用，详细参数仍然显示', () => {
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, lyrics3dEnabled: true } }))
    const html = lyricsMarkup()
    const fieldset = html.slice(html.indexOf('<fieldset'), html.indexOf('>', html.indexOf('<fieldset')))
    expect(fieldset).not.toContain('disabled=')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('背景场景')
    expect(html).toContain('粒子数量')
  })
})
