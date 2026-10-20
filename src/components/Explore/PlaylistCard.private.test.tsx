import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PlaylistCard } from './PlaylistCard'
import type { Playlist } from '../../types/domain'

const playlist: Playlist = { provider: 'netease', source: 'netease', type: 'playlist', id: '1', name: '通勤', cover: '', trackCount: 3, playCount: 0, creator: '' }

describe('歌单卡片可见性', () => {
  it('私有歌单在封面右下角显示小锁，并写进读屏名称', () => {
    const html = renderToStaticMarkup(<PlaylistCard playlist={{ ...playlist, private: true }} onClick={vi.fn()} />)
    expect(html).toContain('title="私有歌单，仅自己可见"')
    expect(html).toContain('aria-label="私有歌单：通勤，3 首"')
  })

  it('公开或未知可见性不显示锁', () => {
    for (const item of [playlist, { ...playlist, private: false }]) {
      expect(renderToStaticMarkup(<PlaylistCard playlist={item} onClick={vi.fn()} />)).not.toContain('私有歌单')
    }
  })
})
