import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { SourceBadge } from './SourceBadge'
import { useProviderStore } from '../../stores/providers'

describe('SourceBadge', () => {
  beforeEach(() => useProviderStore.setState({ sourceBadgeMode: 'always' }))
  it('完整徽标包含可见平台名和读屏名称', () => {
    const html = renderToStaticMarkup(<SourceBadge source="netease" showInactive />)
    expect(html).toContain('网易云')
    expect(html).toContain('aria-label="来源：网易云"')
  })

  it('紧凑徽标仍保留读屏名称', () => {
    const html = renderToStaticMarkup(<SourceBadge source="qq" compact showInactive />)
    expect(html).toContain('aria-label="来源：QQ音乐"')
    expect(html).toContain('title="QQ音乐"')
  })

  it('上游遗漏来源时显示未知而不是让页面崩溃', () => {
    const html = renderToStaticMarkup(<SourceBadge source={undefined} />)
    expect(html).toContain('来源未知')
    expect(html).toContain('>?<')
  })

  it('隐藏模式不渲染来源实体', () => {
    expect(renderToStaticMarkup(<SourceBadge source="netease" displayMode="hidden" showInactive />)).toBe('')
  })

  it('未参与平台不渲染来源实体', () => {
    expect(renderToStaticMarkup(<SourceBadge source="qq" displayMode="always" />)).toBe('')
  })

  it('动态模式在显式来源语境中直接展示', () => {
    const html = renderToStaticMarkup(<SourceBadge source="qq" displayMode="dynamic" showInactive reveal />)
    expect(html).not.toContain('dynamic')
    expect(html).toContain('QQ音乐')
  })
})
