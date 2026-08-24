const SYSTEM_WESTERN_FALLBACK = "-apple-system, 'Segoe UI'"
const SYSTEM_CJK_FALLBACK = "'PingFang SC', 'Microsoft YaHei'"

function selectedFontCssValue(fontFamily: string): string {
  const family = fontFamily.trim()
  // 2.0.1 及更早的设置页允许手输完整 CSS 字体栈；升级后仍按原语义应用。
  if (family.includes(',') || /^(['"]).*\1$/.test(family)) return family
  const escaped = family.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `'${escaped}'`
}

function insertAfterFirstFamily(fontStack: string, fallback: string): string {
  let quote = ''
  let escaped = false
  for (let index = 0; index < fontStack.length; index++) {
    const char = fontStack[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ',') return `${fontStack.slice(0, index)}, ${fallback},${fontStack.slice(index + 1)}`
  }
  return `${fontStack}, ${fallback}`
}

/** 西文字体优先；缺少中文字形时回落到用户指定的中文字体，再走系统兜底。 */
export function fontFamilyCssValue(westernFont: string, cjkFont = ''): string {
  const families: string[] = []
  const western = westernFont.trim()
  const cjk = cjkFont.trim()
  if (western) {
    const westernValue = selectedFontCssValue(western)
    if (cjk && western.includes(',')) {
      families.push(insertAfterFirstFamily(westernValue, selectedFontCssValue(cjk)))
    } else {
      families.push(westernValue)
      if (cjk) families.push(selectedFontCssValue(cjk))
    }
  } else {
    families.push(SYSTEM_WESTERN_FALLBACK)
    if (cjk) families.push(selectedFontCssValue(cjk))
  }
  if (westernFont.trim()) families.push(SYSTEM_WESTERN_FALLBACK)
  families.push(SYSTEM_CJK_FALLBACK, 'sans-serif')
  return families.join(', ')
}
