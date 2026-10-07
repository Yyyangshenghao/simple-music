import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { version } from '../../package.json'
import { ReleaseHistoryPage } from './ReleaseHistoryPage'

describe('独立更新日志页面', () => {
  it('提供返回设置入口，离线展示当前版本与历史记录', () => {
    const html = renderToStaticMarkup(<ReleaseHistoryPage />)
    expect(html).toContain('返回设置')
    expect(html).toContain('>更新日志</h1>')
    expect(html).toContain('离线可读')
    expect(html).toContain('当前版本')
    expect(html).toMatch(new RegExp(`<details[^>]*open=""><summary[^>]*><span[^>]*>v${version.replace(/\./g, '\\.')}<`))
    expect(html).toContain('v2.0.0')
    expect(html).toContain('离线音乐')
    expect(html).toContain('兼容说明')
    expect(html).not.toContain('验证情况')
    expect(html).not.toContain('最终类型检查')
  })

  it('各版本按新增、优化、修复分组，修复版不会显示不存在的新功能分组', () => {
    const html = renderToStaticMarkup(<ReleaseHistoryPage />)
    const releases = html.split('<details').slice(1)
    const feature = releases.find((release) => release.includes('>v2.3.0<'))!
    expect(feature).toContain('aria-label="新增"')
    expect(feature).toContain('aria-label="优化"')
    expect(feature).toContain('aria-label="修复"')
    expect(feature).toContain('data-change-type="feat"')
    expect(feature).toContain('data-change-type="fix"')
    const patch = releases.find((release) => release.includes('>v2.2.4<'))!
    expect(patch).toContain('aria-label="修复"')
    expect(patch).not.toContain('aria-label="新增"')
    expect(patch).not.toContain('data-change-type="feat"')
  })
})
