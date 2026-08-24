import { describe, expect, it } from 'vitest'
import { fontFamilyCssValue } from './font-family'

describe('font family css value', () => {
  it('给字体族加引号并保留系统兜底', () => {
    expect(fontFamilyCssValue('Microsoft YaHei')).toBe(
      "'Microsoft YaHei', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    )
  })

  it('转义引号和反斜杠', () => {
    expect(fontFamilyCssValue("A\\B's Font")).toContain("'A\\\\B\\'s Font'")
  })

  it('兼容旧版保存的完整 CSS 字体栈', () => {
    expect(fontFamilyCssValue('Segoe UI, sans-serif')).toBe(
      "Segoe UI, sans-serif, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    )
    expect(fontFamilyCssValue('"PingFang SC"')).toMatch(/^"PingFang SC", -apple-system/)
  })

  it('把指定中文字体放在西文字体之后作为回退', () => {
    expect(fontFamilyCssValue('Helvetica Neue', 'LXGW WenKai Mono')).toBe(
      "'Helvetica Neue', 'LXGW WenKai Mono', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    )
  })

  it('把中文字体插入旧版完整字体栈的首选字体之后', () => {
    expect(fontFamilyCssValue('"A, B", sans-serif', 'Songti SC')).toMatch(
      /^"A, B", 'Songti SC', sans-serif, -apple-system/
    )
  })
})
