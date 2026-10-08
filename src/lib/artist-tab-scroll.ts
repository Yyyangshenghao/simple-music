/** 目标分类已完成切换，再定位；完成后释放暂存的滚动空间。 */
export function scrollArtistTabToStart(
  viewport: HTMLDivElement,
  top: number,
  behavior: ScrollBehavior,
  complete: () => void,
): () => void {
  const target = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight))
  if (behavior !== 'smooth' || Math.abs(viewport.scrollTop - target) < 1) {
    viewport.scrollTo({ top: target, behavior: 'auto' })
    complete()
    return () => {}
  }
  let pending = true
  const finish = () => {
    if (!pending || Math.abs(viewport.scrollTop - target) >= 1) return
    pending = false
    viewport.removeEventListener('scrollend', finish)
    complete()
  }
  viewport.addEventListener('scrollend', finish)
  viewport.scrollTo({ top: target, behavior })
  return () => {
    if (!pending) return
    pending = false
    viewport.removeEventListener('scrollend', finish)
    viewport.scrollTo({ top: viewport.scrollTop, behavior: 'auto' })
  }
}

/** 释放旧列表高度时，避免短列表把当前滚动位置裁掉。页面顶部无需保留空间。 */
export function artistTabContentHeight(scrollTop: number, viewportHeight: number, contentTop: number, clearance: number): number {
  return scrollTop === 0 ? 0 : Math.max(0, Math.ceil(viewportHeight + scrollTop - contentTop - clearance))
}
