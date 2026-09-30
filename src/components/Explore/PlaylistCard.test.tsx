import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlaylistCard } from './PlaylistCard'
import type { Playlist } from '../../types/domain'

const playlist: Playlist = {
  provider: 'apple', source: 'apple', type: 'playlist', id: 'p.favorite', name: '喜爱歌曲',
  cover: '', trackCount: 0, playCount: 0, creator: 'Apple Music',
}

describe('PlaylistCard', () => {
  it('曲目数未知时不显示误导性的 0 首，已确认空歌单仍显示 0 首', () => {
    const unknown = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, trackCountKnown: false }} onClick={() => {}} />)
    expect(unknown).toContain('查看歌曲')
    expect(unknown).not.toContain('0 首')
    const empty = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, trackCountKnown: true }} onClick={() => {}} />)
    expect(empty).toContain('0 首')
  })

  it('显式隐藏辅助文字时只保留卡片标题', () => {
    const html = renderToStaticMarkup(<PlaylistCard playlist={playlist} meta="" onClick={() => {}} />)
    expect(html.match(/<p\b/g)).toHaveLength(1)
    expect(html).not.toContain('0 首')
    expect(html).toContain('aria-label="歌单：喜爱歌曲"')
  })
})
