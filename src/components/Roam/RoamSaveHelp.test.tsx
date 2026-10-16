import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoamSaveHelp } from './RoamSaveHelp'

describe('漫游说明原位展开', () => {
  it('收起时保留正文排版空间，但不向辅助技术重复公开隐藏说明', () => {
    const html = renderToStaticMarkup(<RoamSaveHelp />)
    expect(html).toMatch(/<p[^>]*role="note"[^>]*aria-hidden="true"/)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="漫游先保存为应用歌单。全部歌曲来自网易云或全部来自 QQ 音乐且已登录时，可在「管理与同步」中手动同步；QQ 顺序以云端为准，混合歌单保存在应用中。"')
  })
})
