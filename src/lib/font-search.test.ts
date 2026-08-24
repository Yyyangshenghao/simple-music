import { describe, expect, it } from 'vitest'
import { filterFontFamilies } from './font-search'

describe('font search', () => {
  const fonts = [
    { family: 'Arial' },
    { family: 'Helvetica Neue' },
    { family: 'Microsoft YaHei', localizedName: '微软雅黑' },
    { family: 'PingFang SC', localizedName: '苹方-简' }
  ]

  it('空关键词保留完整字体列表', () => {
    expect(filterFontFamilies(fonts, '  ')).toEqual(fonts)
  })

  it('忽略大小写并支持部分名称搜索', () => {
    expect(filterFontFamilies(fonts, 'HELV')).toEqual([{ family: 'Helvetica Neue' }])
    expect(filterFontFamilies(fonts, 'yahei')).toEqual([{ family: 'Microsoft YaHei', localizedName: '微软雅黑' }])
  })

  it('支持按中文字体名搜索', () => {
    expect(filterFontFamilies(fonts, '苹方')).toEqual([{ family: 'PingFang SC', localizedName: '苹方-简' }])
  })
})
