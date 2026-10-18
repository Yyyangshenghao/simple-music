import { railSettleTiming } from '../../lib/motion-presets'

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value))

export function measureRail(viewport: HTMLElement) {
  const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
  const children = Array.from(viewport.children) as HTMLElement[]
  const first = children[0]?.offsetLeft ?? 0
  const cards = [0, ...children.slice(1).map(child => clamp(child.offsetLeft - first, maximum)), maximum]
    .filter((value, index, all) => index === 0 || value > all[index - 1] + 1)
  const pages = [0]
  // 留出下一张的边缘提示，每组起点仍与封面对齐。
  const stride = Math.max(1, viewport.clientWidth - first * 2 - 24)
  while (pages[pages.length - 1] < maximum - 1) {
    const current = pages[pages.length - 1]
    const candidates = cards.filter(left => left > current + 1 && left <= current + stride)
    pages.push(candidates.at(-1) ?? cards.find(left => left > current + 1) ?? maximum)
  }
  return { maximum, cards, pages }
}

export function nearestRailPosition(positions: number[], value: number) {
  return positions.reduce((nearest, position) => Math.abs(position - value) < Math.abs(nearest - value) ? position : nearest, positions[0] ?? 0)
}

/** 用页间插值统一点击刻度和滚动位置，包含不足一屏的尾组。 */
export function railProgress(pages: number[], left: number) {
  if (pages.length < 2) return 0
  const upper = pages.findIndex(position => position > left)
  if (upper < 0) return 1
  if (upper === 0) return 0
  const fraction = (left - pages[upper - 1]) / (pages[upper] - pages[upper - 1])
  return (upper - 1 + fraction) / (pages.length - 1)
}

/** 只接管鼠标横向拖动；触控、触控板与滚轮交给浏览器。 */
export function bindRailDrag(viewport: HTMLElement, reducedMotion: () => boolean) {
  let gesture: { id: number; x: number; y: number; left: number; lastX: number; time: number; velocity: number; moved: boolean } | null = null
  let suppressClick = false
  let frame = 0
  const cancelMotion = () => { cancelAnimationFrame(frame); frame = 0 }
  const settle = (velocity: number) => {
    const { maximum, cards } = measureRail(viewport)
    const start = viewport.scrollLeft
    const reduced = reducedMotion()
    const momentum = reduced ? 0 : Math.max(-viewport.clientWidth * 0.8, Math.min(viewport.clientWidth * 0.8, velocity * 140))
    const target = nearestRailPosition(cards, clamp(start + momentum, maximum))
    if (reduced) { viewport.scrollLeft = target; return }
    const started = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / railSettleTiming.duration)
      viewport.scrollLeft = start + (target - start) * railSettleTiming.ease(progress)
      frame = progress < 1 ? requestAnimationFrame(tick) : 0
    }
    frame = requestAnimationFrame(tick)
  }
  const down = (event: PointerEvent) => {
    cancelMotion()
    suppressClick = false
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false) return
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, a, [contenteditable="true"]')) return
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, lastX: event.clientX, time: event.timeStamp, velocity: 0, moved: false }
  }
  const move = (event: PointerEvent) => {
    const current = gesture
    if (!current || current.id !== event.pointerId) return
    if ((event.buttons & 1) === 0) { interrupt(); return }
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (!current.moved) {
      if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return }
      if (Math.abs(dx) < 7) return
      current.moved = true
      suppressClick = true
      viewport.dataset.dragging = 'true'
      viewport.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
    const elapsed = event.timeStamp - current.time
    if (elapsed > 0) current.velocity = (current.lastX - event.clientX) / elapsed
    current.lastX = event.clientX
    current.time = event.timeStamp
    viewport.scrollLeft = current.left - dx
  }
  const finish = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return
    const current = gesture
    gesture = null
    delete viewport.dataset.dragging
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    if (current.moved && event.type === 'pointerup') settle(event.timeStamp - current.time < 80 ? current.velocity : 0)
  }
  const click = (event: MouseEvent) => {
    // detail=0 是键盘/辅助技术激活，不应被上一次鼠标拖动吞掉。
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick = false }
  }
  const preventNativeDrag = (event: DragEvent) => event.preventDefault()
  const interrupt = () => {
    cancelMotion()
    const current = gesture
    gesture = null
    if (current && viewport.hasPointerCapture(current.id)) viewport.releasePointerCapture(current.id)
    delete viewport.dataset.dragging
  }
  viewport.addEventListener('pointerdown', down)
  viewport.addEventListener('pointermove', move)
  viewport.addEventListener('pointerup', finish)
  viewport.addEventListener('pointercancel', finish)
  viewport.addEventListener('lostpointercapture', finish)
  viewport.addEventListener('click', click, true)
  viewport.addEventListener('dragstart', preventNativeDrag)
  viewport.addEventListener('wheel', interrupt, { passive: true })
  viewport.addEventListener('keydown', interrupt)
  return { cancel: interrupt, dispose: () => {
    cancelMotion()
    if (gesture && viewport.hasPointerCapture(gesture.id)) viewport.releasePointerCapture(gesture.id)
    gesture = null
    delete viewport.dataset.dragging
    viewport.removeEventListener('pointerdown', down)
    viewport.removeEventListener('pointermove', move)
    viewport.removeEventListener('pointerup', finish)
    viewport.removeEventListener('pointercancel', finish)
    viewport.removeEventListener('lostpointercapture', finish)
    viewport.removeEventListener('click', click, true)
    viewport.removeEventListener('dragstart', preventNativeDrag)
    viewport.removeEventListener('wheel', interrupt)
    viewport.removeEventListener('keydown', interrupt)
  } }
}
