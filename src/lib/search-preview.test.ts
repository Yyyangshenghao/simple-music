import { describe, expect, it } from 'vitest'
import { SEARCH_PREVIEW_LIMITS, searchPreview } from './search-preview'

const items = Array.from({ length: 40 }, (_, index) => `item-${index}`)

describe('聚合搜索分区预览', () => {
  it('全部视图按上限截取前几项，保留上游顺序并报告剩余数量', () => {
    const preview = searchPreview(items, 'songs', 'all')
    expect(preview.items).toEqual(items.slice(0, SEARCH_PREVIEW_LIMITS.songs))
    expect(preview.hidden).toBe(items.length - SEARCH_PREVIEW_LIMITS.songs)
  })

  it('分类视图展示完整结果，不隐藏任何条目', () => {
    expect(searchPreview(items, 'songs', 'songs')).toEqual({ items, hidden: 0 })
    expect(searchPreview(items, 'albums', 'albums').items).toHaveLength(40)
  })

  it('结果不超过上限时原样返回，不显示查看全部', () => {
    const few = items.slice(0, SEARCH_PREVIEW_LIMITS.artists)
    expect(searchPreview(few, 'artists', 'all')).toEqual({ items: few, hidden: 0 })
  })
})
