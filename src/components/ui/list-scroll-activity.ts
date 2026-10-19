import { createContext } from 'react'

export const ListScrollActivity = createContext(false)
export const LIST_SCROLL_IDLE_MS = 180

/** 连续滚动期间暂停行查询；只在开始和停止时通知，不逐帧更新 React 状态。 */
export function observeListScrollActivity(viewport: EventTarget, onChange: (scrolling: boolean) => void, options: { wheel?: boolean } = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let scrolling = false
  const onScroll = () => {
    if (!scrolling) { scrolling = true; onChange(true) }
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      scrolling = false
      onChange(false)
    }, LIST_SCROLL_IDLE_MS)
  }
  // 同时捕获探索页内部横向轨道的惯性滚动。
  const capture = options.wheel === true
  viewport.addEventListener('scroll', onScroll, { passive: true, capture })
  // 探索页在第一次位移前暂停悬停；滚到边界没有 scroll 事件时也按时恢复。
  if (options.wheel) viewport.addEventListener('wheel', onScroll, { passive: true })
  return () => {
    viewport.removeEventListener('scroll', onScroll, capture)
    if (options.wheel) viewport.removeEventListener('wheel', onScroll)
    if (timer !== undefined) clearTimeout(timer)
  }
}
