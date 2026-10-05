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
  it('无历史时隐藏，关键词作为纯文本显示', () => {
    expect(renderToStaticMarkup(<SearchHistory terms={[]} {...actions} />)).toBe('')
    expect(renderToStaticMarkup(<SearchHistory terms={['<script>']} {...actions} />)).toContain('&lt;script&gt;')
  })
})
