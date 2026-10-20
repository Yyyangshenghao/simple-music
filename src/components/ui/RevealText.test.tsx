import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RevealText } from './RevealText'

describe('说明文字逐字过渡', () => {
  it('保留一份完整可读文本，视觉字符隐藏于辅助技术且 HTML 仍转义', () => {
    const html = renderToStaticMarkup(<RevealText text="<script>介绍</script>" />)
    expect(html).toContain('&lt;script&gt;介绍&lt;/script&gt;</span>')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('<script>')
  })

  it('长简介限制字符节点和等待时间，尾部全文仍然保留', () => {
    const html = renderToStaticMarkup(<RevealText text={'长'.repeat(10000) + '完整结尾'} />)
    expect(html.match(/--reveal-delay:/g)).toHaveLength(121)
    expect(html).toContain('完整结尾</span>')
    const delays = [...html.matchAll(/--reveal-delay:(\d+)ms/g)].map((match) => Number(match[1]))
    expect(Math.max(...delays)).toBe(300)
  })

  it('组合重音与家庭表情保持完整字素，不拆成多个闪动碎片', () => {
    const html = renderToStaticMarkup(<RevealText text={'e\u0301👨‍👩‍👧‍👦'} />)
    expect(html.match(/--reveal-delay:/g)).toHaveLength(2)
    expect(html).toContain('>e\u0301</span>')
    expect(html).toContain('>👨‍👩‍👧‍👦</span>')
  })
})
