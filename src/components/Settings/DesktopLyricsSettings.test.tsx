import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopLyricsSettings } from './DesktopLyricsSettings'

const h = vi.hoisted(() => ({
  fx: {
    desktopLyrics: true,
    desktopLyricsSize: 38,
    desktopLyricsFontFamily: '',
    desktopLyricsColor: '#ffffff',
    desktopLyricsOpacity: 0.92,
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
vi.mock('../ui/Switch', () => ({
  Switch: (props: { checked: boolean; 'aria-label'?: string }) => (
    <button role="switch" aria-checked={props.checked} aria-label={props['aria-label']} />
  )
}))
vi.mock('../ui/SystemFontPicker', () => ({
  SystemFontPicker: (props: { value: string; 'ariaLabel': string }) => (
    <button aria-label={props.ariaLabel}>{props.value || '系统默认'}</button>
  )
}))

beforeEach(() => {
  Object.assign(h.fx, {
    desktopLyricsSize: 38,
    desktopLyricsFontFamily: '',
    desktopLyricsColor: '#ffffff',
    desktopLyricsClickThrough: false,
    desktopLyricsShowTranslation: true,
    desktopLyricsShowRoma: false
  })
})

describe('桌面歌词设置', () => {
  it('提供独立音译开关与预览，操作提示指向左上角', () => {
    h.fx.desktopLyricsShowRoma = true
    const html = renderToStaticMarkup(<DesktopLyricsSettings fonts={[]} loading={false} fontsError={false} onRetryFonts={vi.fn()} />)
    expect(html).toContain('aria-label="桌面歌词显示音译"')
    expect(html).toContain('ongaku to, mainichi o.')
    expect(html).toContain('左上角可缩放')
    h.fx.desktopLyricsShowRoma = false
    const hidden = renderToStaticMarkup(<DesktopLyricsSettings fonts={[]} loading={false} fontsError={false} onRetryFonts={vi.fn()} />)
    expect(hidden).not.toContain('ongaku to, mainichi o.')
  })
  it('窗口缩放产生大字号时，滑杆保留实际字号而不截到原上限', () => {
    h.fx.desktopLyricsSize = 243.6
    const html = renderToStaticMarkup(<DesktopLyricsSettings fonts={[]} loading={false} fontsError={false} onRetryFonts={vi.fn()} />)
    expect(html).toContain('max="244"')
    expect(html).toContain('value="243.6"')
    expect(html).toContain('244 px')
    expect(html).toContain('横向拉宽不会改变字号')
  })

  it('独立字体与自定义颜色应用于预览，不显示关闭的翻译', () => {
    h.fx.desktopLyricsFontFamily = 'Songti SC'
    h.fx.desktopLyricsColor = '#123456'
    h.fx.desktopLyricsShowTranslation = false
    const html = renderToStaticMarkup(<DesktopLyricsSettings fonts={[]} loading={false} fontsError={false} onRetryFonts={vi.fn()} />)
    expect(html).toContain('Songti SC')
    expect(html).toContain('color:#123456')
    expect(html).toContain('aria-label="自定义桌面歌词颜色"')
    expect(html).not.toContain('Let music be with you every day')
  })

  it('字体读取失败可重试，锁定后给出悬停解锁提示', () => {
    h.fx.desktopLyricsClickThrough = true
    const html = renderToStaticMarkup(<DesktopLyricsSettings fonts={[]} loading={false} fontsError onRetryFonts={vi.fn()} />)
    expect(html).toContain('字体读取失败')
    expect(html).toContain('重新读取')
    expect(html).toContain('悬停歌词 0.5 秒')
    expect(html).toContain('aria-label="锁定桌面歌词"')
  })
})
