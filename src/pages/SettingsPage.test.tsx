import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settings'
import { useVisualStore } from '../stores/visual'
import { useUpdateStore } from '../stores/update'
import { useProviderStore } from '../stores/providers'
import { version } from '../../package.json'
import { SettingsPage } from './SettingsPage'

const reducedMotion = vi.hoisted(() => ({ value: false }))
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => reducedMotion.value
}))

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
vi.mock('../stores/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/providers')>()
  const store = original.useProviderStore
  return { ...original, useProviderStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store
  ) }
})
vi.mock('../components/Settings/DesktopLyricsSettings', () => ({ DesktopLyricsSettings: () => <section>桌面歌词显示设置</section> }))
vi.mock('../components/Settings/AppleMusicSettings', () => ({ AppleMusicSettings: () => null, AppleMusicAccountInfo: () => null }))
vi.mock('../components/Settings/ShortcutSettings', () => ({ ShortcutSettings: () => null }))

const initialSettings = useSettingsStore.getState()
const initialVisual = useVisualStore.getState()
const initialUpdate = useUpdateStore.getState()
const initialProviders = useProviderStore.getState()

beforeEach(() => {
  reducedMotion.value = false
  vi.stubGlobal('window', { desktop: { platform: 'darwin' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useSettingsStore.setState((state) => ({ performance: { ...state.performance, lyrics3dEnabled: false } }))
  useVisualStore.setState((state) => ({ fx: { ...state.fx, desktopLyricsFontFamily: 'Helvetica Neue', desktopLyricsFontFamilyCjk: 'Songti SC' } }))
})
afterEach(() => {
  useSettingsStore.setState(initialSettings, true)
  useVisualStore.setState(initialVisual, true)
  useUpdateStore.setState(initialUpdate, true)
  useProviderStore.setState(initialProviders, true)
  vi.unstubAllGlobals()
})

describe('音源账户入口', () => {
  it('已登录账户提供退出入口，停用后仍可退出；未登录账户提供登录入口', () => {
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'authenticated', profile: { nickname: '云音乐用户', avatar: '' } },
      qq: { enabled: false, auth: 'authenticated', profile: { nickname: 'QQ用户', avatar: '' } },
      apple: { enabled: false, auth: 'anonymous' },
    } })
    const html = renderToStaticMarkup(<SettingsPage />)
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*aria-label="退出登录网易云"/)
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*aria-label="退出登录QQ音乐"/)
    expect(html).toContain('云音乐用户')
    expect(html).toContain('QQ用户')
    expect(html).toContain('aria-label="停用网易云"')
    expect(html).toContain('aria-label="启用QQ音乐"')
    useProviderStore.getState().setAccountState('qq', 'anonymous')
    const loggedOut = renderToStaticMarkup(<SettingsPage />)
    expect(loggedOut).toContain('aria-label="登录QQ音乐"')
    expect(loggedOut).not.toContain('aria-label="退出登录QQ音乐"')
    expect(loggedOut).not.toContain('QQ用户')
  })
})

describe('播放顺序中的参与平台', () => {
  it('播放不可用的平台不出现在起播规则和排序列表中', () => {
    useProviderStore.setState({
      playbackOrder: ['netease', 'qq'], preferOriginSource: false,
      byId: {
        netease: { enabled: true, auth: 'authenticated', playbackAvailable: false },
        qq: { enabled: true, auth: 'authenticated', playbackAvailable: true },
        apple: { enabled: false, auth: 'anonymous' },
      },
    })
    const html = renderToStaticMarkup(<SettingsPage />)
    const currentRule = html.slice(html.indexOf('你的联网设置'), html.indexOf('两种方式'))
    expect(currentRule).toContain('QQ音乐')
    expect(currentRule).not.toContain('网易云')
    expect(html).not.toContain('拖动网易云调整顺序')
    expect(html).not.toContain('role="radiogroup" aria-label="起播方式"')
  })
})

describe('缓存与下载的清理边界', () => {
  it('缓存区域不提供同时删除下载歌曲的清空入口', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    const storage = html.slice(html.indexOf('<section id="settings-section-cache"'), html.indexOf('<section id="settings-section-shortcuts"'))
    expect(storage).not.toContain('清空全部')
    expect(storage).toContain('清理自动缓存')
    expect(storage).toContain('删除离线音频')
    expect(storage).toContain('管理下载与目录')
    expect(storage).toContain('清理播放器缓存不会删除这些文件')
    expect(storage).toContain('清理缓存不会删除已下载歌曲')
  })
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

function visualMarkup(): string {
  const html = renderToStaticMarkup(<SettingsPage />)
  return html.slice(html.indexOf('<section id="settings-section-visual"'), html.indexOf('<section id="settings-section-lyrics"'))
}

function effectSwitch(html: string, label: string): string {
  const button = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]
  expect(button).toBeDefined()
  return button!
}

describe('动效设置的实际生效状态', () => {
  it('按影响区域分组，卡片倾斜和光斑分别提供开关', () => {
    const html = visualMarkup()
    for (const title of ['可读性', '动效预设', '背景氛围', '交互反馈', '播放视觉']) {
      expect(html).toMatch(new RegExp(`<h3[^>]*>${title}`))
    }
    expect(effectSwitch(html, '卡片倾斜')).toBeDefined()
    expect(effectSwitch(html, '卡片跟手光斑')).toBeDefined()
    expect(html).not.toContain('点击火花')
    expect(html).toContain('保留按钮与卡片的基本悬停、按压反馈。')
    expect(html.indexOf('可读性')).toBeLessThan(html.indexOf('界面字体'))
    expect(html.indexOf('游戏模式')).toBeGreaterThan(html.indexOf('播放视觉'))
  })

  it('关闭流体背景只暂停鼠标跟随，保留跟随偏好供重新开启时恢复', () => {
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, bgFluidMotion: false, bgPointerMotion: true } }))
    const html = visualMarkup()
    expect(effectSwitch(html, '背景鼠标跟随')).toContain('disabled=""')
    expect(effectSwitch(html, '背景鼠标跟随')).toContain('aria-checked="true"')
    expect(html).toContain('开启流体背景后生效')
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, bgFluidMotion: true } }))
    expect(effectSwitch(visualMarkup(), '背景鼠标跟随')).not.toContain('disabled=')
    expect(useSettingsStore.getState().performance.bgPointerMotion).toBe(true)
  })

  it('独立透明度和 3D 歌词偏好不改变装饰预设匹配', () => {
    useSettingsStore.getState().applyPerformancePreset('standard')
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, reduceTransparency: true, lyrics3dEnabled: false } }))
    expect(visualMarkup()).toMatch(/<button[^>]*aria-pressed="true"[^>]*>标准<\/button>/)
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, reduceTransparency: false, lyrics3dEnabled: true } }))
    expect(visualMarkup()).toMatch(/<button[^>]*aria-pressed="true"[^>]*>标准<\/button>/)
  })

  it('减少透明度时禁用流体并解释原因，关闭后仍保留原偏好', () => {
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, bgFluidMotion: true, reduceTransparency: true } }))
    const suppressed = visualMarkup()
    expect(effectSwitch(suppressed, '流体背景')).toContain('disabled=""')
    expect(effectSwitch(suppressed, '流体背景')).toContain('aria-checked="true"')
    expect(effectSwitch(suppressed, '背景鼠标跟随')).toContain('disabled=""')
    expect(effectSwitch(suppressed, '背景鼠标跟随')).toContain('aria-checked="true"')
    expect(suppressed).toContain('减少透明度已开启，背景流体暂不生效；关闭后恢复原设置。')
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, reduceTransparency: false } }))
    expect(effectSwitch(visualMarkup(), '流体背景')).not.toContain('disabled=')
    expect(useSettingsStore.getState().performance.bgFluidMotion).toBe(true)
  })

  it('系统减弱动态时解释受限效果，并保留已开启偏好', () => {
    reducedMotion.value = true
    const html = visualMarkup()
    for (const label of ['流体背景', '背景鼠标跟随', '卡片倾斜', '卡片跟手光斑', '标题流光', '音频辉光']) {
      expect(effectSwitch(html, label)).toContain('disabled=""')
      expect(effectSwitch(html, label)).toContain('aria-checked="true"')
    }
    expect(html).toContain('系统已开启减弱动态，相关装饰动效暂不生效；原设置已保留。')
    expect(effectSwitch(html, '减少透明度')).not.toContain('disabled=')
  })

  it('节能档禁用背景流体和音频辉光，但不影响卡片开关', () => {
    useVisualStore.setState({ performanceMode: 'eco' })
    const html = visualMarkup()
    expect(effectSwitch(html, '流体背景')).toContain('disabled=""')
    expect(effectSwitch(html, '背景鼠标跟随')).toContain('disabled=""')
    expect(effectSwitch(html, '卡片跟手光斑')).not.toContain('disabled=')
    expect(effectSwitch(html, '音频辉光')).toContain('disabled=""')
    expect(effectSwitch(html, '卡片倾斜')).not.toContain('disabled=')
    expect(html).toContain('当前为节能档，背景流体与音频辉光暂不生效；原设置已保留。')
  })

  it('预设展示选择状态、各档范围与独立的 3D 歌词说明', () => {
    const html = visualMarkup()
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>标准<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>简单模式<\/button>/)
    expect(html).toContain('标准：开启全部装饰动效；简单：静止背景；极简：关闭全部装饰动效。')
    expect(html).toContain('透明度与 3D 歌词独立设置，切换预设不会改变。')
  })
})

describe('歌词设置分组', () => {
  it('减少透明度时禁用简洁叠层模糊，原数值仍保留', () => {
    useSettingsStore.setState((state) => ({
      lyrics3dStyle: 'focus', lyricsOverlayBlur: 0.8,
      performance: { ...state.performance, lyrics3dEnabled: true, reduceTransparency: true }
    }))
    const html = lyricsMarkup()
    const blurRow = html.slice(html.indexOf('当前歌词底部模糊'), html.indexOf('当前歌词底部模糊') + 500)
    expect(blurRow).toMatch(/<input[^>]*disabled=""/)
    expect(html).toContain('减少透明度已开启，歌词底部模糊暂不生效；原数值已保留。')
    expect(useSettingsStore.getState().lyricsOverlayBlur).toBe(0.8)
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, reduceTransparency: false } }))
    const restored = lyricsMarkup()
    const restoredRow = restored.slice(restored.indexOf('当前歌词底部模糊'), restored.indexOf('当前歌词底部模糊') + 500)
    expect(restoredRow).not.toMatch(/<input[^>]*disabled=/)
    expect(restoredRow).toContain('value="0.8"')
  })

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
