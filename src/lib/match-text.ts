import * as OpenCC from 'opencc-js/t2cn'

const simplifyTw = OpenCC.Converter({ from: 'tw', to: 'cn' })
const simplifyHk = OpenCC.Converter({ from: 'hk', to: 'cn' })

/** 宽字符转半角、繁体转简体，各式括号统一成半角圆括号。 */
export function normalizeBrackets(value: string): string {
  return simplifyHk(simplifyTw(value.normalize('NFKC')))
    .replace(/[（【［〔]/g, '(')
    .replace(/[）】］〕]/g, ')')
}

/** 同曲匹配用文本归一化：兼容繁简、宽字符、大小写、标点和空白差异。 */
export function normalizeMatchText(value: string): string {
  return normalizeBrackets(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}
