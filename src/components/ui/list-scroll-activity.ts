import { createContext } from 'react'

export const ListScrollActivity = createContext(false)
export const LIST_SCROLL_IDLE_MS = 180

/** 滚轮停顿不重启悬停动效；结束滚动后，主动指针或焦点操作才恢复。 */
export function observeCardScrollActivity(viewport: EventTarget, onChange: (paused: boolean) => void): () => void {
  let scrolling = false
  let paused = false
  const stop = observeListScrollActivity(viewport, (active) => {
    scrolling = active
    if (active && !paused) {
      paused = true
      onChange(true)
    }
  }, { wheel: true })
  const resume = () => {
    if (scrolling || !paused) return
    paused = false
    onChange(false)
  }
  viewport.addEventListener('pointermove', resume, { passive: true })
  viewport.addEventListener('pointerdown', resume, { passive: true })
  viewport.addEventListener('focusin', resume)
  return () => {
    stop()
    viewport.removeEventListener('pointermove', resume)
    viewport.removeEventListener('pointerdown', resume)
    viewport.removeEventListener('focusin', resume)
  }
}

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
    viewport.removeEventListener('scroll', onScroll, { capture })
    if (options.wheel) viewport.removeEventListener('wheel', onScroll)
    if (timer !== undefined) clearTimeout(timer)
  }
}
