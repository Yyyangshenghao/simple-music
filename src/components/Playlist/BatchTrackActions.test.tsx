import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BatchTrackActions } from './BatchTrackActions'
import type { Playlist, Track } from '../../types/domain'

const track = (source: Track['source']): Track => ({ provider: source, source, type: 'track', id: 1, name: '晴天', artist: '周杰伦', artists: [] })
const selection = { total: 10, onSelectAll() {}, onClear() {}, onExit() {} }

describe('批量操作栏', () => {
  it('网易和 QQ 混选保留加入队列、下载与选区控制', () => {
    const html = renderToStaticMarkup(<BatchTrackActions tracks={[track('netease'), track('qq')]} selection={selection} />)
    expect(html).toMatch(/<strong[^>]*>2<\/strong>/)
    expect(html).toContain('已选项目')
    expect(html).toContain('添加到播放队列')
    expect(html).toContain('下载所选（2 首）')
    expect(html).not.toContain('全部下载')
    expect(html).toContain('全选')
    expect(html).toContain('清空')
    expect(html).toContain('退出多选')
    expect(html).toContain('拖动框选 / Shift 连选')
  })

  it('混选 Apple Music 时只提供队列操作，不提供普通下载', () => {
    const html = renderToStaticMarkup(<BatchTrackActions tracks={[track('netease'), track('apple')]} selection={selection} />)
    expect(html).toContain('添加到播放队列')
    expect(html).not.toContain('下载所选')
  })

  it('清空后保留退出和全选，禁用批量操作', () => {
    const html = renderToStaticMarkup(<BatchTrackActions tracks={[]} selection={selection} />)
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []
    expect(html).toMatch(/<strong[^>]*>0<\/strong>/)
    expect(buttons.find(button => button.includes('添加到播放队列'))).toMatch(/<button[^>]*disabled=""/)
    expect(buttons.find(button => button.includes('下载所选（0 首）'))).toMatch(/<button[^>]*disabled=""/)
    expect(buttons.find(button => button.includes('全选'))).not.toContain('disabled=""')
    expect(html).toContain('退出多选')
  })

  it('歌曲数量按来源和 ID 去重，并排除不可播放的歌曲', () => {
    const html = renderToStaticMarkup(<BatchTrackActions tracks={[track('netease'), { ...track('netease'), id: '1' }, track('qq'), { ...track('qq'), id: 2, playable: false }]} selection={selection} />)
    expect(html).toContain('下载所选（2 首）')
  })

  it('集合曲数标为预估，未知曲数不显示为零', () => {
    const album: Playlist = { provider: 'netease', source: 'netease', type: 'album', id: 2, name: '专辑', cover: '', creator: '', trackCount: 12, playCount: 0 }
    expect(renderToStaticMarkup(<BatchTrackActions tracks={[track('netease')]} collections={[album]} selection={selection} />)).toContain('下载所选（约 13 首）')
    expect(renderToStaticMarkup(<BatchTrackActions tracks={[]} collections={[{ ...album, trackCount: 0, trackCountKnown: false }]} selection={selection} />)).toContain('下载所选（曲数待确认）')
    expect(renderToStaticMarkup(<BatchTrackActions tracks={[]} collections={[{ ...album, trackCount: 0 }]} selection={selection} />)).toContain('下载所选（曲数待确认）')
  })
})
