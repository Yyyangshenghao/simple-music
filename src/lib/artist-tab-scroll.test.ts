import { describe, expect, it, vi } from 'vitest'
import { scrollBeforeArtistTabChange } from './artist-tab-scroll'

function page(top = 1000, height = 3000) {
  const node = Object.assign(new EventTarget(), {
    scrollTop: top, scrollHeight: height, clientHeight: 700, scrollTo: vi.fn(),
  })
  return node as unknown as HTMLDivElement
}

describe('歌手分类切换前回滚', () => {
  it('动画完成前保留旧列表，结束后只切换一次', () => {
    const viewport = page()
    const commit = vi.fn()
    scrollBeforeArtistTabChange(viewport, 330, 'smooth', commit)
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 330, behavior: 'smooth' })
    expect(commit).not.toHaveBeenCalled()
    viewport.scrollTop = 330
    viewport.dispatchEvent(new Event('scrollend'))
    viewport.dispatchEvent(new Event('scrollend'))
    expect(commit).toHaveBeenCalledTimes(1)
  })
  it('旧动画结束事件不能提前提交新的定位', () => {
    const viewport = page()
    const commit = vi.fn()
    scrollBeforeArtistTabChange(viewport, 330, 'smooth', commit)
    viewport.dispatchEvent(new Event('scrollend'))
    expect(commit).not.toHaveBeenCalled()
    viewport.scrollTop = 330
    viewport.dispatchEvent(new Event('scrollend'))
    expect(commit).toHaveBeenCalledOnce()
  })
  it('点击相似歌手先平滑滚到页面顶部', () => {
    const viewport = page()
    scrollBeforeArtistTabChange(viewport, 0, 'smooth', vi.fn())
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
  it('用户中断或快速改选后不会执行过期切换', () => {
    const viewport = page()
    const commit = vi.fn()
    const cancel = scrollBeforeArtistTabChange(viewport, 0, 'smooth', commit)
    viewport.scrollTop = 650
    cancel()
    viewport.dispatchEvent(new Event('scrollend'))
    expect(commit).not.toHaveBeenCalled()
    expect(viewport.scrollTo).toHaveBeenLastCalledWith({ top: 650, behavior: 'auto' })
  })
  it('无滚动距离时立即完成，不等待不会产生的 scrollend', () => {
    const viewport = page(0, 700)
    const commit = vi.fn()
    scrollBeforeArtistTabChange(viewport, 330, 'smooth', commit)
    expect(commit).toHaveBeenCalledOnce()
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
  it('减少动画时直接定位，完成后取消不会停止新的滚动', () => {
    const viewport = page()
    const commit = vi.fn()
    const cancel = scrollBeforeArtistTabChange(viewport, 330, 'auto', commit)
    cancel()
    expect(commit).toHaveBeenCalledOnce()
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1)
  })
})
