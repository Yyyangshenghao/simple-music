import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Track } from '../../types/domain'
import { AppPlaylistCover } from './AppPlaylistCover'

const track = (cover?: string): Track => ({ provider: 'netease', source: 'netease', type: 'song', id: cover, name: '歌曲', artist: '', artists: [], cover })

function images(node: ReactNode): ReactElement<{ onError(event: { currentTarget: { hidden: boolean } }): void }>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return []
    return child.type === 'img' ? [child as ReactElement<{ onError(event: { currentTarget: { hidden: boolean } }): void }>] : images(child.props.children)
  })
}

describe('应用歌单拼图封面', () => {
  it('空歌单和无效封面使用 SVG 音符，不请求占位地址', () => {
    const html = renderToStaticMarkup(<AppPlaylistCover tracks={[track('?n=1')]} />)
    expect(html).toContain('data-cover-count="0"')
    expect(html).toContain('aria-label="应用歌单封面"')
    expect(html).toContain('<svg')
    expect(html).not.toContain('<img')
  })

  it('单张与多张采用真实封面，并继承调用方样式', () => {
    const single = renderToStaticMarkup(<AppPlaylistCover tracks={[track('https://covers.test/a')]} className="cardCover" />)
    expect(single).toContain('cardCover')
    expect(single).toContain('data-cover-count="1"')
    expect(single).toContain('src="https://covers.test/a"')
    const collage = renderToStaticMarkup(<AppPlaylistCover tracks={['a', 'b', 'c', 'd', 'e'].map(id => track(`https://covers.test/${id}`))} />)
    expect(collage).toContain('data-cover-count="4"')
    expect(collage.match(/<img/g)).toHaveLength(4)
    expect(collage).not.toContain('src="https://covers.test/e"')
  })

  it('图片加载失败时隐藏破图，显示后方已有 SVG 回退', () => {
    const tree = AppPlaylistCover({ tracks: [track('https://covers.test/broken')] })
    const image = images(tree)[0]
    const currentTarget = { hidden: false }
    image.props.onError({ currentTarget })
    expect(currentTarget.hidden).toBe(true)
    expect(renderToStaticMarkup(tree)).toContain('<svg')
  })
})
