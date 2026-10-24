import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settings'
import { useVisualStore } from '../stores/visual'
import { useUpdateStore } from '../stores/update'
import { useProviderStore } from '../stores/providers'
import { useWindowCloseStore } from '../stores/window-close'
import { version } from '../../package.json'
import { SettingsPage } from './SettingsPage'

const reducedMotion = vi.hoisted(() => ({ value: false }))
vi.mock('../stores/window-close', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/window-close')>()
  const store = original.useWindowCloseStore
  return { ...original, useWindowCloseStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store
  ) }
})
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => reducedMotion.value,
  useSystemReducedMotion: () => reducedMotion.value,
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
const initialWindowClose = useWindowCloseStore.getState()

beforeEach(() => {
  reducedMotion.value = false
  vi.stubGlobal('window', { desktop: { platform: 'darwin' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useVisualStore.setState((state) => ({ fx: { ...state.fx, desktopLyricsFontFamily: 'Helvetica Neue', desktopLyricsFontFamilyCjk: 'Songti SC' } }))
})
afterEach(() => {
  useSettingsStore.setState(initialSettings, true)
  useVisualStore.setState(initialVisual, true)
  useUpdateStore.setState(initialUpdate, true)
  useProviderStore.setState(initialProviders, true)
  useWindowCloseStore.setState(initialWindowClose, true)
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
    expect(storage).toContain('管理下载')
    expect(storage).toContain('更改目录只影响之后加入的任务，已有文件保留')
    expect(storage).toContain('清理缓存不会删除下载目录中的歌曲')
    expect(storage).toContain('更改位置会删除原目录中的缓存、离线音频及未识别旧文件')
    expect(storage).toContain('下载目录中的歌曲不受影响')
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
    expect(about).toMatch(/<button[^>]*aria-label="查看更新日志"[^>]*>查看<\/button>/)
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
    expect(about).toMatch(/<button[^>]*aria-label="查看更新日志"[^>]*>查看<\/button>/)
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

describe('Windows 关闭方式设置', () => {
  it('macOS 不展示关闭方式，Windows 加载完成后展示当前选择', () => {
    expect(visualMarkup()).not.toContain('关闭窗口方式')
    window.desktop.platform = 'win32'
    useWindowCloseStore.setState({ behavior: 'tray', initialized: true })
    const html = visualMarkup()
    expect(html).toContain('关闭窗口方式')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>缩回托盘<\/button>/)
    expect(html).toContain('每次询问')
    expect(html).toContain('退出应用')
  })

  it('读取未完成和保存期间禁用选项，读取失败提供重试', () => {
    window.desktop.platform = 'win32'
    expect(visualMarkup()).toContain('正在读取关闭方式…')
    expect(visualMarkup()).toMatch(/<button[^>]*disabled=""[^>]*>每次询问<\/button>/)
    useWindowCloseStore.setState({ initialized: true, pending: true })
    expect(visualMarkup()).toMatch(/<button[^>]*disabled=""[^>]*>每次询问<\/button>/)
    useWindowCloseStore.setState({ pending: false, error: '无法读取关闭方式，请重试。' })
    expect(visualMarkup()).toContain('重新读取')
  })
})

function effectSwitch(html: string, label: string): string {
  const button = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]
  expect(button).toBeDefined()
  return button!
}

describe('动效设置的实际生效状态', () => {
  it('减少动态开关可随时解除，其他动效保留选择并显示暂停原因', () => {
    useSettingsStore.getState().setPerformance({ reduceMotion: true })
    const html = visualMarkup()
    expect(effectSwitch(html, '减少动态效果')).toContain('aria-checked="true"')
    expect(effectSwitch(html, '减少动态效果')).not.toContain('disabled=')
    for (const label of ['文字逐字显现', '歌词逐字高亮', '流体背景', '卡片倾斜', '音频辉光']) {
      expect(effectSwitch(html, label)).toContain('disabled=""')
      expect(effectSwitch(html, label)).toContain('aria-checked="true"')
    }
    expect(html).toContain('已随减少动态效果暂停')
    useSettingsStore.getState().setPerformance({ reduceMotion: false })
    expect(effectSwitch(visualMarkup(), '歌词逐字高亮')).not.toContain('disabled=')
  })
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
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, reduceTransparency: true } }))
    expect(visualMarkup()).toMatch(/<button[^>]*aria-pressed="true"[^>]*>标准<\/button>/)
    useSettingsStore.setState((state) => ({ performance: { ...state.performance, reduceTransparency: false } }))
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
    expect(html).toContain('系统已开启减弱动态，相关动效暂不生效；原设置已保留。')
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
    expect(html).toContain('标准：保留完整动效；简单：静止背景、直接显示说明；极简：再停止界面转场与歌词逐字高亮。')
    expect(html).toContain('减少透明度独立设置，切换预设不会改变。')
  })
})

describe('歌词设置分组', () => {
  it('粒光参数和专用字体统一放在歌词页，设置页不再重复展示', () => {
    const html = lyricsMarkup()
    for (const label of ['粒光设置', '粒光选项', '同屏歌词', '歌词行间距', '粒光歌词中文字体', '启用立体歌词']) {
      expect(html).not.toContain(label)
    }
  })

  it('桌面和普通歌词字体保留在独立卡片', () => {
    const html = lyricsMarkup()
    const [beforeDetails] = html.split('<fieldset')
    expect(beforeDetails).toContain('aria-label="桌面歌词西文字体"')
    expect(beforeDetails).toContain('aria-label="桌面歌词中文字体"')
    expect(beforeDetails).toContain('aria-label="普通歌词西文字体"')
    expect(beforeDetails).not.toContain('粒光歌词中文字体')
    expect(beforeDetails).toContain('Helvetica Neue')
    expect(beforeDetails).toContain('Songti SC')
    const fontCard = beforeDetails.slice(beforeDetails.indexOf('歌词字体'), beforeDetails.indexOf('</section>', beforeDetails.indexOf('歌词字体')))
    expect(fontCard).not.toContain('disabled=""')
    expect(fontCard).not.toContain('aria-expanded=')
  })


})


describe('设置分类导航', () => {
  it('全部分类连续展示，原分类按钮负责收放二级目录', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    const sections = [...html.matchAll(/<section id="settings-section-([^"]+)"([^>]*)>/g)]
    expect(sections).toHaveLength(6)
    expect(sections.find(section => section[1] === 'music')![2]).not.toContain('hidden=')
    expect(sections.some(section => section[2].includes('hidden='))).toBe(false)
    expect(html).not.toContain('收起设置目录')
    expect(html).not.toContain('展开设置目录')
    expect(html).toMatch(/aria-current="page"[^>]*aria-expanded="true"/)
    expect(html).toMatch(/aria-current="page"[^>]*aria-controls="settings-section-music settings-subnav-music"/)
  })

  it('二级入口都指向唯一分组，原有账户和缓存边界保留', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    for (const id of ['accounts', 'playback', 'appearance', 'interface-font', 'mini-player', 'motion', 'effects', 'game',
      'desktop-lyrics', 'lyrics-font', 'lyrics-source', 'downloads', 'temporary-cache', 'offline-audio', 'cache-location']) {
      expect(html.match(new RegExp(`id="settings-detail-${id}"`, 'g'))).toHaveLength(1)
    }
    expect(html).toContain('aria-controls="settings-detail-accounts"')
    expect(html).toContain('清理缓存不会删除下载目录中的歌曲')
    expect(html).not.toContain('粒光设置')
    expect(html).not.toContain('社区模组')
  })
})
