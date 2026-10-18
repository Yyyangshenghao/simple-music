import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoamSaveHelp } from './RoamSaveHelp'

describe('漫游说明原位展开', () => {
  it('收起时保留正文排版空间，但不向辅助技术重复公开隐藏说明', () => {
    const html = renderToStaticMarkup(<RoamSaveHelp />)
    expect(html).toMatch(/<p[^>]*role="note"[^>]*aria-hidden="true"/)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="漫游结果保存在应用歌单中，可聚合不同平台的歌曲。通过「管理歌单」整理歌曲；不会修改平台歌单。"')
  })
})
