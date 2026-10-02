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
