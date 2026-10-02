import { expect, it } from 'vitest'
import { desktopLyricsHeight, desktopLyricsSize } from './desktop-lyrics-layout'

it.each([false, true])('单行/翻译布局按高度等比例缩放且字号与高度互逆：%s', (translation) => {
  for (const size of [12, 38, 72, 240]) {
    expect(desktopLyricsSize(desktopLyricsHeight(size, translation), translation)).toBeCloseTo(size)
  }
  expect(desktopLyricsSize(180, translation)).toBeGreaterThan(desktopLyricsSize(90, translation))
})

it('翻译行共享文字高度，小窗口仍保留最小可读字号', () => {
  expect(desktopLyricsSize(120, true)).toBeLessThan(desktopLyricsSize(120, false))
  expect(desktopLyricsSize(10, true)).toBe(12)
})

it('原文、音译和翻译三行共同分配高度，音译单独显示同样收紧', () => {
  for (const translation of [false, true]) {
    for (const size of [12, 38, 120]) {
      expect(desktopLyricsSize(desktopLyricsHeight(size, translation, true), translation, true)).toBeCloseTo(size)
    }
  }
  expect(desktopLyricsSize(180, true, true)).toBeLessThan(desktopLyricsSize(180, true))
})
