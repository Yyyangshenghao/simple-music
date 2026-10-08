import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SearchHistory } from './SearchHistory'

const actions = { onSelect: () => {}, onRemove: () => {}, onClear: () => {} }
describe('搜索历史入口', () => {
  it('按最近搜索的顺序展示，并提供逐项删除与清空入口', () => {
    const html = renderToStaticMarkup(<SearchHistory terms={['晴天', '周杰伦']} {...actions} />)
    expect(html).toContain('aria-label="搜索历史"')
    expect(html.indexOf('title="晴天"')).toBeLessThan(html.indexOf('title="周杰伦"'))
    expect(html).toContain('aria-label="删除搜索历史：晴天"')
    expect(html).toContain('>清空</button>')
  })
  it('一万条历史默认只渲染最近十条，提供查看更多入口但不显示数量', () => {
    const terms = Array.from({ length: 10000 }, (_, i) => `关键词${i}`)
    const html = renderToStaticMarkup(<SearchHistory terms={terms} {...actions} />)
    expect((html.match(/aria-label="删除搜索历史：/g) ?? [])).toHaveLength(10)
    expect(html).toContain('title="关键词9"')
    expect(html).not.toContain('title="关键词10"')
    expect(html).toContain('>查看更多</span>')
    expect(html).not.toContain('10,000 条')
    expect(html).not.toContain('条更早搜索')
    expect(html).toContain('aria-expanded="false"')
  })

  it('不超过十条时无需查看更多', () => {
    const terms = Array.from({ length: 10 }, (_, i) => `关键词${i}`)
    expect(renderToStaticMarkup(<SearchHistory terms={terms} {...actions} />)).not.toContain('查看更多')
  })

  it('无历史时隐藏，关键词作为纯文本显示', () => {
    expect(renderToStaticMarkup(<SearchHistory terms={[]} {...actions} />)).toBe('')
    expect(renderToStaticMarkup(<SearchHistory terms={['<script>']} {...actions} />)).toContain('&lt;script&gt;')
  })
})
