import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopLyricsSettings } from './DesktopLyricsSettings'

const h = vi.hoisted(() => ({
  settings: { fontFamily: '', fontFamilyCjk: '' },
  fx: {
    desktopLyrics: true,
    desktopLyricsSize: 38,
    desktopLyricsFontFamily: '',
    desktopLyricsFontFamilyCjk: '',
    desktopLyricsColor: '#ffffff',
    desktopLyricsOpacity: 0.92,
    desktopLyricsBackgroundOpacity: 0.68,
    desktopLyricsBackgroundStyle: 'dark',
    desktopLyricsLineMode: 'single',
    desktopLyricsWordByWord: false,
    desktopLyricsClickThrough: false,
    desktopLyricsShowTranslation: true,
    desktopLyricsShowRoma: false,
    desktopLyricsHighlight: true
  },
  updateFx: vi.fn()
}))

vi.mock('../../stores/visual', () => ({
  useVisualStore: (selector: (state: typeof h) => unknown) => selector(h)
}))
vi.mock('../../stores/settings', () => ({ useSettingsStore: (selector: (state: typeof h.settings) => unknown) => selector(h.settings) }))
vi.mock('../ui/Switch', () => ({
  Switch: (props: { checked: boolean; 'aria-label'?: string }) => (
    <button role="switch" aria-checked={props.checked} aria-label={props['aria-label']} />
  )
}))

beforeEach(() => {
  Object.assign(h.settings, { fontFamily: '', fontFamilyCjk: '' })
  Object.assign(h.fx, {
    desktopLyricsSize: 38,
    desktopLyricsFontFamily: '',
    desktopLyricsFontFamilyCjk: '',
    desktopLyricsColor: '#ffffff',
    desktopLyricsBackgroundOpacity: 0.68,
    desktopLyricsBackgroundStyle: 'dark',
    desktopLyricsLineMode: 'single',
    desktopLyricsWordByWord: false,
    desktopLyricsClickThrough: false,
    desktopLyricsShowTranslation: true,
    desktopLyricsShowRoma: false
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('桌面歌词设置', () => {
  it.each(['win32', 'linux'])('在 %s 禁用毛玻璃并将旧保存效果回退为暗灰色预览', (platform) => {
    vi.stubGlobal('window', { desktop: { platform } })
    h.fx.desktopLyricsBackgroundStyle = 'frosted'
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-pressed="false"[^>]*>毛玻璃/)
    expect(html).toContain('title="此系统使用暗灰色底框"')
    expect(html).toContain('此系统使用暗灰色底框。')
    expect(html).toContain('aria-pressed="true">暗灰色')
    expect(html).toContain('backdrop-filter:none')
    expect(html).not.toContain('backdrop-filter:blur(16px)')
    expect(h.fx.desktopLyricsBackgroundStyle).toBe('frosted')
  })

  it('底框透明度与文字透明度独立，毛玻璃预览应用所选效果', () => {
    h.fx.desktopLyricsBackgroundOpacity = 0.35
    h.fx.desktopLyricsBackgroundStyle = 'frosted'
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).toContain('文字不透明度')
    expect(html).toContain('底框不透明度')
    expect(html).toContain('background-color:rgba(24, 27, 32, 0.35)')
    expect(html).toContain('backdrop-filter:blur(16px)')
    expect(html).toContain('opacity:0.92')
    expect(html).toContain('aria-pressed="true">毛玻璃')
    expect(html).toContain('aria-pressed="false">暗灰色')
    h.fx.desktopLyricsBackgroundStyle = 'dark'
    const dark = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(dark).toContain('backdrop-filter:none')
    expect(dark).toContain('aria-pressed="true">暗灰色')
  })

  it('双行预览显示下一句，逐字开关提供无时间数据的回退提示', () => {
    h.fx.desktopLyricsLineMode = 'double'
    h.fx.desktopLyricsWordByWord = true
    h.fx.desktopLyricsShowRoma = true
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).toContain('下一句，也有音乐相伴')
    expect(html.indexOf('下一句，也有音乐相伴')).toBeLessThan(html.indexOf('ràng yīn yuè péi nǐ zǒu guò měi yì tiān'))
    expect(html).toContain('aria-pressed="true">双行')
    expect(html).toContain('aria-checked="true" aria-label="桌面歌词逐字高亮"')
    expect(html).toContain('歌曲没有逐字时间数据时，仍按整句显示。')
    h.fx.desktopLyricsLineMode = 'single'
    h.fx.desktopLyricsWordByWord = false
    const single = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(single).not.toContain('下一句，也有音乐相伴')
    expect(single).toContain('aria-pressed="true">单行')
    expect(single).toContain('aria-checked="false" aria-label="桌面歌词逐字高亮"')
  })

  it.each(['single', 'double'])('在 %s 预览中切换翻译和音译不替换示例歌词', (lineMode) => {
    h.fx.desktopLyricsLineMode = lineMode
    h.fx.desktopLyricsWordByWord = false
    for (const translation of [false, true]) {
      for (const roma of [false, true]) {
        h.fx.desktopLyricsShowTranslation = translation
        h.fx.desktopLyricsShowRoma = roma
        const html = renderToStaticMarkup(<DesktopLyricsSettings />)
        expect(html).toContain('让音乐陪你走过每一天')
        expect(html.includes('Let music be with you every day')).toBe(translation)
        expect(html.includes('ràng yīn yuè péi nǐ zǒu guò měi yì tiān')).toBe(roma)
        expect(html.includes('下一句，也有音乐相伴')).toBe(lineMode === 'double')
      }
    }
  })

  it('字体选择移到统一分组，桌面预览仍使用独立中西文字体', () => {
    Object.assign(h.settings, { fontFamily: 'Helvetica Neue', fontFamilyCjk: 'PingFang SC' })
    h.fx.desktopLyricsFontFamilyCjk = 'Songti SC'
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).not.toContain('aria-label="桌面歌词西文字体"')
    expect(html).not.toContain('aria-label="桌面歌词中文字体"')
    expect(html).toContain('font-family:&#x27;Helvetica Neue&#x27;, &#x27;Songti SC&#x27;')
    expect(html).not.toContain('font-family:&#x27;Helvetica Neue&#x27;, &#x27;PingFang SC&#x27;')
  })
  it('提供独立音译开关与预览，操作提示指向左上角', () => {
    h.fx.desktopLyricsShowRoma = true
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).toContain('aria-label="桌面歌词显示音译"')
    expect(html).toContain('ràng yīn yuè péi nǐ zǒu guò měi yì tiān')
    expect(html).toContain('左上角可缩放')
    h.fx.desktopLyricsShowRoma = false
    const hidden = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(hidden).not.toContain('ràng yīn yuè péi nǐ zǒu guò měi yì tiān')
  })
  it('窗口缩放产生大字号时，滑杆保留实际字号而不截到原上限', () => {
    h.fx.desktopLyricsSize = 243.6
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).toContain('max="244"')
    expect(html).toContain('value="243.6"')
    expect(html).toContain('244 px')
    expect(html).toContain('横向拉宽不会改变字号')
  })

  it('独立字体与自定义颜色应用于预览，不显示关闭的翻译', () => {
    h.fx.desktopLyricsFontFamily = 'Songti SC'
    h.fx.desktopLyricsColor = '#123456'
    h.fx.desktopLyricsShowTranslation = false
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).toContain('Songti SC')
    expect(html).toContain('color:#123456')
    expect(html).toContain('aria-label="自定义桌面歌词颜色"')
    expect(html).not.toContain('Let music be with you every day')
  })

  it('锁定后保留常态底框，提示悬停解锁且不重复字体读取入口', () => {
    h.fx.desktopLyricsClickThrough = true
    const html = renderToStaticMarkup(<DesktopLyricsSettings />)
    expect(html).not.toContain('字体读取失败')
    expect(html).not.toContain('重新读取')
    expect(html).toContain('底框常态显示，锁定后也保留；设为 0% 可隐藏底框。')
    expect(html).not.toContain('移到歌词上才显示底框')
    expect(html).toContain('悬停歌词 0.5 秒')
    expect(html).toContain('aria-label="锁定桌面歌词"')
  })
})
