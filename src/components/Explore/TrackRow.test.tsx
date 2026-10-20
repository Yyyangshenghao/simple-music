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
    expect(html).toContain('aria-label="加入歌单"')
    expect(html).toMatch(/<div[^>]*><button[^>]*disabled=""/)
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/)
    expect(html).not.toContain('保存到本地')
    expect(html).not.toContain('红心')
  })

  it('可播放行带悬停播放符号、时长与专辑；同源列表可隐藏来源徽标', () => {
    const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 2, name: '晴天', artist: '周杰伦', artists: [{ id: 10, name: '周杰伦' }], album: '叶惠美', duration: 269000 }
    const html = renderToStaticMarkup(<TrackRow track={track} index={0} onPlay={vi.fn()} hideSource />)
    expect(html).toMatch(/class="[^"]*playGlyph/)
    expect(html).toContain('4:29')
    expect(html).toContain('叶惠美')
    expect(html).not.toContain('来源：')
  })
})
