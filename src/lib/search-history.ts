/** 搜索历史:localStorage 持久化,去重、新词置顶、上限 15 条。 */

const STORAGE_KEY = 'simplemusic-search-history'
export const MAX_HISTORY = 15

/** 纯函数:把新词插到最前,去掉重复(不区分首尾空白),超上限截断。 */
export function pushTerm(history: string[], term: string, max = MAX_HISTORY): string[] {
  const t = term.trim()
  if (!t) return history
  return [t, ...history.filter((h) => h !== t)].slice(0, max)
}

/** 纯函数:删除一条历史。 */
export function removeTerm(history: string[], term: string): string[] {
  return history.filter((h) => h !== term)
}

export function loadSearchHistory(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(data) ? data.filter((it): it is string => typeof it === 'string').slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

export function saveSearchHistory(history: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch {
    /* 存储满等异常忽略 */
  }
}
