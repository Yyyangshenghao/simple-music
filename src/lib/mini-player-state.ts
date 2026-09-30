import type { MiniPlayerPayload } from '../types/ipc'

/** 跨桥对象身份会改变；按外观字段值比较，进度更新不重新复制静态状态。 */
export function miniPlayerPatch(previous: MiniPlayerPayload, incoming: MiniPlayerPayload): MiniPlayerPayload {
  return Object.fromEntries(Object.entries(incoming).filter(([field, value]) => {
    const key = field as keyof MiniPlayerPayload
    if (key !== 'appearance') return !Object.is(previous[key], value)
    const before = previous.appearance
    const after = incoming.appearance
    if (!before || !after) return before !== after
    return (Object.keys(after) as Array<keyof typeof after>).some((property) => before[property] !== after[property])
  }))
}

export function mergeMiniPlayerPayload(previous: MiniPlayerPayload, incoming: MiniPlayerPayload): MiniPlayerPayload {
  const patch = miniPlayerPatch(previous, incoming)
  return Object.keys(patch).length ? { ...previous, ...patch } : previous
}
