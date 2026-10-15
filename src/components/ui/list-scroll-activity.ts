import { createContext } from 'react'

export const ListScrollActivity = createContext(false)
export const LIST_SCROLL_IDLE_MS = 180

/** 连续滚动期间暂停行查询；只在开始和停止时通知，不逐帧更新 React 状态。 */
export function observeListScrollActivity(viewport: EventTarget, onChange: (scrolling: boolean) => void): () => void {
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
  viewport.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    viewport.removeEventListener('scroll', onScroll)
    if (timer !== undefined) clearTimeout(timer)
  }
}
