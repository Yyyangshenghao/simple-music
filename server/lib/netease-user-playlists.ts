export interface NeteaseUserPlaylistPage {
  items: unknown[]
  more: boolean
}

type FetchUserPlaylistPage = (offset: number, limit: number) => Promise<NeteaseUserPlaylistPage>

const PAGE_SIZE = 100
const MAX_PAGES = 20

function itemKey(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const id = (item as Record<string, unknown>).id
  return id === undefined || id === null ? '' : String(id)
}

/**
 * 完整收集用户歌单。首屏偶发只返回“我喜欢的音乐”且错误标记 more=false 时，
 * 额外从 offset=1 探测一次；分页重复时及时停止，避免上游忽略 offset 导致死循环。
 */
export async function collectNeteaseUserPlaylists(
  fetchPage: FetchUserPlaylistPage,
  maxItems = 2000
): Promise<unknown[]> {
  const result: unknown[] = []
  const seen = new Set<string>()
  let offset = 0

  for (let pageIndex = 0; pageIndex < MAX_PAGES && result.length < maxItems; pageIndex++) {
    const limit = Math.min(PAGE_SIZE, maxItems - result.length)
    let page: NeteaseUserPlaylistPage
    try {
      page = await fetchPage(offset, limit)
    } catch (error) {
      if (result.length === 0) throw error
      break
    }
    if (page.items.length === 0) break

    let added = 0
    for (const item of page.items) {
      const key = itemKey(item)
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      result.push(item)
      added++
      if (result.length >= maxItems) break
    }
    if (added === 0) break

    offset += page.items.length
    const probeAfterLikedOnly = pageIndex === 0 && page.items.length === 1 && !page.more
    if (!page.more && !probeAfterLikedOnly) break
  }

  return result
}
