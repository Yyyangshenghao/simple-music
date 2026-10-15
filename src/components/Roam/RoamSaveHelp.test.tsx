import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoamSaveHelp } from './RoamSaveHelp'

describe('漫游说明原位展开', () => {
  it('收起时保留正文排版空间，但不向辅助技术重复公开隐藏说明', () => {
    const html = renderToStaticMarkup(<RoamSaveHelp />)
    expect(html).toMatch(/<p[^>]*role="note"[^>]*aria-hidden="true"/)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="从已启用平台挑选歌手。混合结果只保存在本地，单一网易云来源且已登录时可同步「每日漫游」。"')
  })
})
