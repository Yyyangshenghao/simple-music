import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import styles from './WindowChrome.module.css'

const h = vi.hoisted(() => ({ state: { isMaximized: false, isFullScreen: false } }))
vi.mock('../../stores/window', () => ({
  useWindowStore: (selector: (state: typeof h.state) => unknown) => selector(h.state)
}))
import { WindowChrome } from './WindowChrome'

beforeEach(() => {
  h.state.isMaximized = false
  h.state.isFullScreen = false
  vi.stubGlobal('window', { desktop: { platform: 'win32' } })
})

it.each([
  ['win32', true, true],
  ['linux', true, false],
  ['darwin', false, false],
  [undefined, false, false]
])('%s 仅 Windows 启用新窗口按钮，其他平台保留原来的入口', (platform, hasButtons, hasWindowsStyle) => {
  window.desktop.platform = platform as typeof window.desktop.platform
  const html = renderToStaticMarkup(<WindowChrome><main>音乐</main></WindowChrome>)
  expect(html.includes('aria-label="最小化"')).toBe(hasButtons)
  expect(html.includes(styles.captionButtonsWin)).toBe(hasWindowsStyle)
  expect(html.includes('viewBox="0 0 16 16"')).toBe(hasWindowsStyle)
  if (platform === 'linux') expect(html).toContain('viewBox="0 0 10 10"')
  expect(html).toContain('<main>音乐</main>')
})

it.each(['win32', 'linux'])('%s 最大化时显示还原，全屏时隐藏按钮', (platform) => {
  window.desktop.platform = platform as typeof window.desktop.platform
  h.state.isMaximized = true
  const maximized = renderToStaticMarkup(<WindowChrome>音乐</WindowChrome>)
  expect(maximized).toContain('aria-label="向下还原"')
  expect(maximized).not.toContain('aria-label="最大化"')
  h.state.isFullScreen = true
  const fullScreen = renderToStaticMarkup(<WindowChrome>音乐</WindowChrome>)
  expect(fullScreen).not.toContain('<button')
  expect(fullScreen).toContain('音乐')
})

it.each([
  ['win32', false],
  ['linux', true],
  ['darwin', false],
  [undefined, false]
])('%s 展开歌词时仅 Windows 隐藏窗口按钮，收起后恢复原有显示', (platform, hasButtons) => {
  window.desktop.platform = platform as typeof window.desktop.platform
  const expanded = renderToStaticMarkup(<WindowChrome lyricsOpen><main>歌词</main></WindowChrome>)
  for (const label of ['最小化', '最大化', '关闭']) {
    expect(expanded.includes(`aria-label="${label}"`)).toBe(hasButtons)
  }
  expect(expanded).toContain('<main>歌词</main>')
  const collapsed = renderToStaticMarkup(<WindowChrome lyricsOpen={false}>音乐</WindowChrome>)
  expect(collapsed.includes('aria-label="最小化"')).toBe(platform === 'win32' || platform === 'linux')
})
