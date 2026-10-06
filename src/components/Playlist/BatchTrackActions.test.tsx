import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BatchTrackActions } from './BatchTrackActions'
import type { Track } from '../../types/domain'

const track = (source: Track['source']): Track => ({ provider: source, source, type: 'track', id: 1, name: '晴天', artist: '周杰伦', artists: [] })
const selection = { total: 10, onSelectAll() {}, onClear() {}, onExit() {} }

describe('浮动批量操作', () => {
  it('网易和 QQ 混选保留加入队列、下载与选区控制', () => {
    const html = renderToStaticMarkup(<BatchTrackActions floating tracks={[track('netease'), track('qq')]} selection={selection} />)
    expect(html).toContain('已选 <strong>2</strong> 项')
    expect(html).toContain('添加到播放队列')
    expect(html).toContain('批量下载')
    expect(html).toContain('全选')
    expect(html).toContain('清空')
    expect(html).toContain('退出多选')
    expect(html).not.toContain('拖动框选 / Shift 连选')
  })

  it('混选 Apple Music 时只提供队列操作，不提供普通下载', () => {
    const html = renderToStaticMarkup(<BatchTrackActions floating tracks={[track('netease'), track('apple')]} selection={selection} />)
    expect(html).toContain('添加到播放队列')
    expect(html).not.toContain('批量下载')
  })

  it('清空后保留退出和全选，禁用批量操作', () => {
    const html = renderToStaticMarkup(<BatchTrackActions floating tracks={[]} selection={selection} />)
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []
    expect(html).toContain('已选 <strong>0</strong> 项')
    expect(buttons.find(button => button.includes('添加到播放队列'))).toMatch(/<button[^>]*disabled=""/)
    expect(buttons.find(button => button.includes('批量下载'))).toMatch(/<button[^>]*disabled=""/)
    expect(buttons.find(button => button.includes('全选'))).not.toContain('disabled=""')
    expect(html).toContain('退出多选')
  })
})
