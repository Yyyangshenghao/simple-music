// Stack 卡片堆的池子逻辑：手牌（渲染中的卡，末位=顶卡）、池子（待补）、已甩出（池子耗尽时循环回收）。

export interface StackPoolState<T> {
  hand: T[]
  reserve: T[]
  discarded: T[]
}

export function createPool<T>(items: T[], handSize = 5): StackPoolState<T> {
  // 渲染顺序后者在上层，reverse 让 items[0] 成为顶卡
  return { hand: items.slice(0, handSize).reverse(), reserve: items.slice(handSize), discarded: [] }
}

export function swipeTop<T>(state: StackPoolState<T>): StackPoolState<T> {
  if (state.hand.length === 0) return state
  const top = state.hand[state.hand.length - 1]
  const rest = state.hand.slice(0, -1)
  const discarded = [...state.discarded, top]
  if (state.reserve.length > 0) {
    return { hand: [state.reserve[0], ...rest], reserve: state.reserve.slice(1), discarded }
  }
  // 池子耗尽（拉新全重复或请求失败）：回收最早甩出的卡，保证拖拽永远有下一张
  const [recycled, ...remaining] = discarded
  return { hand: [recycled, ...rest], reserve: [], discarded: remaining }
}

/** 换一叠：整手弃掉（顶卡先弃，与 swipeTop 弃序一致），从池子抽新手牌；池子不足时回收最早弃掉的卡补齐。 */
export function redeal<T>(state: StackPoolState<T>, handSize = 5): StackPoolState<T> {
  const discarded = [...state.discarded, ...[...state.hand].reverse()]
  const reserve = [...state.reserve]
  const drawn: T[] = []
  while (drawn.length < handSize && (reserve.length > 0 || discarded.length > 0)) {
    drawn.push(reserve.length > 0 ? reserve.shift()! : discarded.shift()!)
  }
  // 先抽到的是顶卡，reverse 放到末位（渲染顺序后者在上层）
  return { hand: drawn.reverse(), reserve, discarded }
}

export function refill<T>(state: StackPoolState<T>, incoming: T[], getId: (t: T) => unknown): StackPoolState<T> {
  const seen = new Set([...state.hand, ...state.reserve, ...state.discarded].map(getId))
  const fresh: T[] = []
  for (const item of incoming) {
    const id = getId(item)
    if (seen.has(id)) continue
    seen.add(id)
    fresh.push(item)
  }
  if (fresh.length === 0) return state
  return { ...state, reserve: [...state.reserve, ...fresh] }
}

export function needsRefill<T>(state: StackPoolState<T>, threshold = 5): boolean {
  return state.reserve.length <= threshold
}
