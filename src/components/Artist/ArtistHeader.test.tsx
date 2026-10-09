import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArtistHeader } from './ArtistHeader'
import type { ArtistInfo } from '../../types/domain'

const artist: ArtistInfo = { id: 1, name: '歌手', avatar: '', source: 'netease' }
describe('歌手简介展示', () => {
  it('有简介时可展开阅读，作为纯文本转义显示', () => {
    const html = renderToStaticMarkup(<ArtistHeader artist={{ ...artist, description: '<script>介绍</script>' }} onPlayAll={() => {}} />)
    expect(html).toContain('<span>歌手简介</span>')
    expect(html).toContain('>展开</span>')
    expect(html).toContain('aria-label="完整歌手简介"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('&lt;script&gt;介绍&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
  it('无简介时不显示空的展开入口', () => {
    expect(renderToStaticMarkup(<ArtistHeader artist={artist} onPlayAll={() => {}} />)).not.toContain('歌手简介')
  })
})
