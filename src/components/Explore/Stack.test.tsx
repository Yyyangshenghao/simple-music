import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Playlist } from '../../types/domain'
import { Stack } from './Stack'

const cards = ['底牌', '顶牌'].map((name, index): Playlist => ({
  id: index, provider: 'qq', source: 'qq', type: 'playlist', name,
  cover: '', trackCount: 0, playCount: 0, creator: '',
}))

describe('推荐牌堆键盘入口', () => {
  it('仅顶牌作为可聚焦按钮公开，底牌不能抢走键盘焦点', () => {
    const html = renderToStaticMarkup(<Stack cards={cards} onSwipe={() => {}} onCardClick={() => {}} />)
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toContain('disabled=""')
    expect(buttons[0]).toContain('tabindex="-1"')
    expect(buttons[1]).not.toContain('disabled')
    expect(buttons[1]).toContain('tabindex="0"')
    expect(buttons[1]).toContain('aria-label="查看歌单：顶牌"')
  })
})
