import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { LyricsPayload } from '../../src/types/ipc'

const harness = vi.hoisted(() => ({ payload: {} as LyricsPayload, render: vi.fn() }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: harness.render }) }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [harness.payload, vi.fn()]
}))

beforeAll(async () => {
  vi.stubGlobal('document', { getElementById: () => ({}) })
  await import('./index')
})
afterAll(() => vi.unstubAllGlobals())

function renderOverlay(payload: LyricsPayload): string {
  harness.payload = payload
  return renderToStaticMarkup(harness.render.mock.calls[0][0] as ReactElement)
}

it('未锁定时保留锁定、关闭和调整大小控件，没有顶部提示条', () => {
  const html = renderOverlay({ clickThrough: false, line: '测试歌词' })
  expect(html).toContain('aria-label="锁定桌面歌词"')
  expect(html).toContain('aria-label="关闭桌面歌词"')
  expect(html).toContain('aria-label="调整桌面歌词窗口大小"')
  expect(html).not.toContain('拖动调整位置')
  expect(html).not.toContain('role="toolbar"')
  expect(html).toContain('拖动左上角调整宽高')
})

it('音译在主歌词和翻译之间显示，关闭时没有额外空行', () => {
  const html = renderOverlay({ line: '音楽', roma: 'ongaku', translation: '音乐' })
  expect(html.indexOf('音楽')).toBeLessThan(html.indexOf('ongaku'))
  expect(html.indexOf('ongaku')).toBeLessThan(html.indexOf('音乐'))
  expect(html.match(/data-desktop-lyrics-text/g)).toHaveLength(3)
  expect(renderOverlay({ line: '音楽', roma: '', translation: '' }).match(/data-desktop-lyrics-text/g)).toHaveLength(1)
})

it('锁定时隐藏编辑控件，悬停提示到达后才启用解锁图标', () => {
  const hidden = renderOverlay({ clickThrough: true, unlockVisible: false })
  expect(hidden).not.toContain('aria-label="锁定桌面歌词"')
  expect(hidden).not.toContain('aria-label="关闭桌面歌词"')
  expect(hidden).not.toContain('aria-label="调整桌面歌词窗口大小"')
  expect(hidden).toContain('aria-hidden="true"')
  expect(hidden).toContain('disabled=""')
  const visible = renderOverlay({ clickThrough: true, unlockVisible: true })
  expect(visible).toContain('aria-label="解锁桌面歌词"')
  expect(visible).toContain('aria-hidden="false"')
  expect(visible).not.toContain('disabled=""')
})

it('窗口使用西文优先、中文回退的字体组合', () => {
  const html = renderOverlay({ line: '音乐 Music', fontFamily: 'Helvetica Neue', fontFamilyCjk: 'Songti SC' })
  expect(html).toContain('font-family:&#x27;Helvetica Neue&#x27;, &#x27;Songti SC&#x27;')
})

it('双行显示下一句，音译和翻译继续作为独立辅助行', () => {
  const html = renderOverlay({ line: '第一句', nextLine: '第二句', roma: 'diyiju', translation: 'First line' })
  expect(html.indexOf('第一句')).toBeLessThan(html.indexOf('第二句'))
  expect(html.indexOf('第二句')).toBeLessThan(html.indexOf('diyiju'))
  expect(html.match(/data-desktop-lyrics-text/g)).toHaveLength(4)
  expect(html).toContain('calc((100cqh - 8px - 12px) / 4)')
})

it('底框传递透明度与毛玻璃样式，并限制透明度范围', () => {
  const html = renderOverlay({ backgroundStyle: 'frosted', nativeGlass: true, backgroundOpacity: 0.35 })
  expect(html).toContain('frosted')
  expect(html).toContain('--frame-opacity:0.35')
  expect(renderOverlay({ backgroundOpacity: 3 })).toContain('--frame-opacity:1')
  expect(renderOverlay({})).toContain('--frame-opacity:0.68')
})

it('精准逐字歌词包含低亮底字及裁剪高亮层，无时序或不匹配时退回整句', () => {
  const wordLine = { time: 1, durationMs: 400, words: [
    { text: '音乐', startMs: 0, durationMs: 200 },
    { text: ' Music', startMs: 200, durationMs: 200 }
  ] }
  const wordClock = { elapsedMs: 100, playing: true, rate: 1 }
  const html = renderOverlay({ line: '音乐 Music', wordLine, wordClock })
  expect(html.match(/data-desktop-lyrics-word-fill/g)).toHaveLength(2)
  expect(renderOverlay({ line: '音乐 Music', wordClock })).not.toContain('data-desktop-lyrics-word-fill')
  expect(renderOverlay({ line: '其他句', wordLine, wordClock })).not.toContain('data-desktop-lyrics-word-fill')
  expect(renderOverlay({ line: '音乐 Music', wordLine })).not.toContain('data-desktop-lyrics-word-fill')
  expect(renderOverlay({ line: '音乐 Music', wordClock, wordLine: {
    ...wordLine, words: wordLine.words.map(({ durationMs: _duration, ...word }) => word)
  } })).not.toContain('data-desktop-lyrics-word-fill')
})


it('文字与底框透明度独立，不让文字透明度改变底框及控件', () => {
  const html = renderOverlay({ opacity: 0.45, backgroundOpacity: 0.8 })
  expect(html).toContain('--frame-opacity:0.8')
  expect(html).toContain('opacity:0.45;font-family:')
  expect(renderOverlay({ opacity: 0 })).toContain('opacity:0.28;font-family:')
  expect(renderOverlay({ opacity: 5 })).toContain('opacity:1;font-family:')
  expect(renderOverlay({})).toContain('opacity:0.92;font-family:')
})

it('原生毛玻璃不可用时实际底框回退暗灰色', () => {
  const html = renderOverlay({ line: '歌词', backgroundStyle: 'frosted', nativeGlass: false })
  expect(html).not.toMatch(/class="[^"\n]*_frosted_/)
})
