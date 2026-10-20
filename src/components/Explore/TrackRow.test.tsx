import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Track } from '../../types/domain'
import { TrackRow } from './TrackRow'

describe('TrackRow 不可播放状态', () => {
  it('禁止播放但仍可收藏，继续隐藏离线保存与红心操作', () => {
    const track: Track = {
      provider: 'netease',
      source: 'netease',
      type: 'song',
      id: 1,
      name: '暂无版权歌曲',
      artist: '王力宏',
      artists: [{ id: 10, name: '王力宏' }],
      playable: false,
    }

    const html = renderToStaticMarkup(
      <TrackRow track={track} index={0} onPlay={vi.fn()} disabled statusLabel="暂无版权" />
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('暂无版权')
    expect(html).toContain('aria-label="加入应用歌单"')
    expect(html).toMatch(/<div[^>]*><button[^>]*disabled=""/)
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/)
    expect(html).not.toContain('保存到本地')
    expect(html).not.toContain('红心')
  })
})
