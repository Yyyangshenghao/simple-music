import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MINI_PLAYER_APPEARANCE, MINI_PLAYER_LYRICS_WIDTH } from '../../lib/mini-player-config'
import { MiniPlayerBar } from './MiniPlayerBar'

function renderBar(width: number, showLyrics = true): string {
  return renderToStaticMarkup(
    <MiniPlayerBar
      trackTitle="测试歌曲"
      artistName="测试歌手"
      lyricLine="这是一句用于验证展示状态的歌词"
      appearance={{ ...DEFAULT_MINI_PLAYER_APPEARANCE, showLyrics }}
      width={width}
    />
  )
}

describe('MiniPlayerBar 歌词布局状态', () => {
  it('达到展开宽度后启用歌词专用布局', () => {
    const html = renderBar(MINI_PLAYER_LYRICS_WIDTH)

    expect(html).toContain('data-expanded="true"')
    expect(html).toContain('data-lyrics="true"')
    expect(html).toContain('这是一句用于验证展示状态的歌词')
  })

  it('宽度不足或关闭歌词时保持普通布局', () => {
    const compact = renderBar(MINI_PLAYER_LYRICS_WIDTH - 1)
    const hidden = renderBar(MINI_PLAYER_LYRICS_WIDTH + 200, false)

    expect(compact).toContain('data-lyrics="false"')
    expect(compact).not.toContain('这是一句用于验证展示状态的歌词')
    expect(hidden).toContain('data-lyrics="false"')
    expect(hidden).not.toContain('这是一句用于验证展示状态的歌词')
  })
})
