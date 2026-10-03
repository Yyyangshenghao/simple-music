import { expect, it } from 'vitest'
import { desktopLyricsHeight, desktopLyricsSize } from './desktop-lyrics-layout'

it('默认字号为每行预留上下空间，窗口完整容纳原文和辅助行', () => {
  expect(desktopLyricsHeight(38, false)).toBeCloseTo(95.5)
  expect(desktopLyricsHeight(38, true)).toBeCloseTo(128)
  expect(desktopLyricsHeight(38, false, true)).toBeCloseTo(128)
  expect(desktopLyricsHeight(38, true, true)).toBeCloseTo(160.5)
  expect(desktopLyricsHeight(38, false, false, true)).toBeCloseTo(147)
  expect(desktopLyricsHeight(38, true, true, true)).toBeCloseTo(212)
})

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

it('双行原文与翻译/音译共同分配高度，缩放互逆且均保留最小字号', () => {
  for (const translation of [false, true]) {
    for (const roma of [false, true]) {
      for (const size of [12, 38, 120]) {
        expect(desktopLyricsSize(desktopLyricsHeight(size, translation, roma, true), translation, roma, true)).toBeCloseTo(size)
      }
    }
  }
  expect(desktopLyricsHeight(38, false, false, true)).toBeGreaterThan(desktopLyricsHeight(38, true))
  expect(desktopLyricsSize(10, true, true, true)).toBe(12)
})
