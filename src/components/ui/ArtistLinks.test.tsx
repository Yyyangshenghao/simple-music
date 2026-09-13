import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArtistLinks } from './ArtistLinks'

describe('合作曲歌手展示', () => {
  it('缺少 MID 的歌手显示为文字，保留其他歌手的详情入口', () => {
    const html = renderToStaticMarkup(<ArtistLinks source="qq" artists={[
      { id: null, name: '无 MID 歌手' },
      { id: 'artist-mid', name: '有 MID 歌手' },
    ]} />)
    expect(html).toContain('无 MID 歌手</span>')
    expect(html).toContain('有 MID 歌手</button>')
    expect(html.match(/<button/g)).toHaveLength(1)
  })
})
