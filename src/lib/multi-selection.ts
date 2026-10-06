export interface SelectionRect { left: number; top: number; right: number; bottom: number }

export function selectionRect(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) }
}

export function intersectsSelection(a: SelectionRect, b: SelectionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** 按完整列表的行坐标取选区，虚拟列表中尚未挂载的行同样可选。 */
export function virtualSelectionKeys(rect: SelectionRect, list: SelectionRect, rowHeight: number, keys: string[]): string[] {
  if (!intersectsSelection(rect, list)) return []
  const start = Math.max(0, Math.floor((rect.top - list.top) / rowHeight))
  const end = Math.min(keys.length, Math.ceil((rect.bottom - list.top) / rowHeight))
  return keys.slice(start, end)
}

export function applySelection(base: Set<string>, keys: string[], mode: 'replace' | 'add' | 'toggle'): Set<string> {
  const next = mode === 'replace' ? new Set<string>() : new Set(base)
  for (const key of keys) {
    if (mode === 'toggle' && next.has(key)) next.delete(key)
    else next.add(key)
  }
  return next
}

export function rangeSelection(keys: string[], anchor: string | null, target: string): string[] {
  const end = keys.indexOf(target)
  const start = anchor === null ? -1 : keys.indexOf(anchor)
  if (end < 0) return []
  return start < 0 ? [target] : keys.slice(Math.min(start, end), Math.max(start, end) + 1)
}
