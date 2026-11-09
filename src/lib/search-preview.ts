// 聚合搜索「全部」视图的分区预览：只截取每类前几项，顺序与上游返回一致，其余由「查看全部」进入分类完整展示。

export type SearchPreviewKind = 'songs' | 'artists' | 'albums' | 'playlists'

/** 「全部」先并排预览歌曲与歌手，专辑与歌单各预览一组封面。 */
export const SEARCH_PREVIEW_LIMITS: Record<SearchPreviewKind, number> = {
  songs: 5,
  artists: 4,
  albums: 6,
  playlists: 6,
}

export interface SearchPreview<T> {
  items: T[]
  /** 未在预览中显示、需进入分类查看的数量。 */
  hidden: number
}

/** 分类视图返回完整结果；「全部」视图按上限截取，不改变顺序。 */
export function searchPreview<T>(items: T[], kind: SearchPreviewKind, category: 'all' | SearchPreviewKind): SearchPreview<T> {
  if (category !== 'all') return { items, hidden: 0 }
  const limit = SEARCH_PREVIEW_LIMITS[kind]
  return items.length > limit ? { items: items.slice(0, limit), hidden: items.length - limit } : { items, hidden: 0 }
}
