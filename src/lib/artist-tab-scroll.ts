/** 保留旧列表直到回滚完成，避免切到短列表时浏览器先裁剪滚动位置。 */
export function scrollBeforeArtistTabChange(
  viewport: HTMLDivElement,
  top: number,
  behavior: ScrollBehavior,
  commit: () => void,
): () => void {
  const target = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight))
  if (behavior !== 'smooth' || Math.abs(viewport.scrollTop - target) < 1) {
    viewport.scrollTo({ top: target, behavior: 'auto' })
    commit()
    return () => {}
  }
  let pending = true
  const finish = () => {
    if (!pending || Math.abs(viewport.scrollTop - target) >= 1) return
    pending = false
    viewport.removeEventListener('scrollend', finish)
    commit()
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
