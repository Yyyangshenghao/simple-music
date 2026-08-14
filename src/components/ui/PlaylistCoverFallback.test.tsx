import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlaylistCoverFallback } from './PlaylistCoverFallback'

describe('PlaylistCoverFallback', () => {
  it('QQ 我喜欢使用红心设计封面', () => {
    const html = renderToStaticMarkup(<PlaylistCoverFallback name="我喜欢" source="qq" />)
    expect(html).toContain('data-kind="favorite"')
    expect(html).toContain('data-source="qq"')
    expect(html).toContain('<svg')
  })

  it('普通缺图歌单使用音乐符号', () => {
    const html = renderToStaticMarkup(<PlaylistCoverFallback name="未命名歌单" source="netease" />)
    expect(html).toContain('data-kind="playlist"')
    expect(html).toContain('♪')
  })
})
