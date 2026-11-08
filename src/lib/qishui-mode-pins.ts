/** 探索页听歌模式的常用区：像系统托盘，放不下的留在“更多”里。 */
export const QISHUI_MAX_PINNED_MODES = 5
export const DEFAULT_QISHUI_PINNED_MODES: readonly string[] = ['default', 'familiar', 'fresh']

export type ModeDropTarget = { zone: 'row'; index: number } | { zone: 'tray' } | null

export function normalizeQishuiPinnedModes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_QISHUI_PINNED_MODES]
  const ids = value.filter((id): id is string => typeof id === 'string' && /^[a-z0-9_]{1,32}$/.test(id))
  return [...new Set(ids)].slice(0, QISHUI_MAX_PINNED_MODES)
}

/** 落到常用区：已固定的调整顺序，有空位就插入，满了替换落点那个；落到“更多”取消固定；落在别处不变。 */
export function applyModeDrop(pins: readonly string[], id: string, target: ModeDropTarget): string[] {
  if (!target) return [...pins]
  if (target.zone === 'tray') return pins.filter(item => item !== id)
  const rest = pins.filter(item => item !== id)
  const index = Math.max(0, Math.min(target.index, rest.length))
  if (rest.length < QISHUI_MAX_PINNED_MODES) return [...rest.slice(0, index), id, ...rest.slice(index)]
  const replaced = Math.min(index, rest.length - 1)
  return rest.map((item, position) => position === replaced ? id : item)
}
