export const TOP_MENU_ITEMS = {
  explore: '探索',
  search: '搜索',
  library: '我的库',
  roam: '漫游',
  shuange: '刷歌',
  settings: '设置',
} as const

export type TopMenuId = keyof typeof TOP_MENU_ITEMS
export interface TopMenuItem {
  id: TopMenuId
  enabled: boolean
}

const TOP_MENU_IDS = Object.keys(TOP_MENU_ITEMS) as TopMenuId[]

export function normalizeTopMenu(value: unknown): TopMenuItem[] {
  const items: TopMenuItem[] = []
  const seen = new Set<TopMenuId>()
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = TOP_MENU_IDS.find(id => id === item?.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      items.push({ id, enabled: item.enabled !== false })
    }
  }
  for (const id of TOP_MENU_IDS) {
    if (!seen.has(id)) items.push({ id, enabled: true })
  }
  return items
}

export const DEFAULT_TOP_MENU = normalizeTopMenu(undefined)
