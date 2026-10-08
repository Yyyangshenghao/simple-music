import { describe, expect, it, vi } from 'vitest'
import { artistTabContentHeight, scrollArtistTabToStart } from './artist-tab-scroll'

function page(top = 1000, height = 3000) {
  const node = Object.assign(new EventTarget(), {
    scrollTop: top, scrollHeight: height, clientHeight: 700, scrollTo: vi.fn(),
  })
  return node as unknown as HTMLDivElement
}

describe('歌手分类切换后定位', () => {
  it('目标列表滚动完成后只释放一次临时空间', () => {
    const viewport = page()
    const complete = vi.fn()
    scrollArtistTabToStart(viewport, 330, 'smooth', complete)
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 330, behavior: 'smooth' })
    expect(complete).not.toHaveBeenCalled()
    viewport.scrollTop = 330
    viewport.dispatchEvent(new Event('scrollend'))
    viewport.dispatchEvent(new Event('scrollend'))
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('旧动画结束事件不能提前结束新的定位', () => {
    const viewport = page()
    const complete = vi.fn()
    scrollArtistTabToStart(viewport, 330, 'smooth', complete)
    viewport.dispatchEvent(new Event('scrollend'))
    expect(complete).not.toHaveBeenCalled()
    viewport.scrollTop = 330
    viewport.dispatchEvent(new Event('scrollend'))
    expect(complete).toHaveBeenCalledOnce()
  })
  it('相似歌手目标内容平滑滚到页面顶部', () => {
    const viewport = page()
    scrollArtistTabToStart(viewport, 0, 'smooth', vi.fn())
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
  it('用户中断或快速改选后不会执行过期完成回调', () => {
    const viewport = page()
    const complete = vi.fn()
    const cancel = scrollArtistTabToStart(viewport, 0, 'smooth', complete)
    viewport.scrollTop = 650
    cancel()
    viewport.dispatchEvent(new Event('scrollend'))
    expect(complete).not.toHaveBeenCalled()
    expect(viewport.scrollTo).toHaveBeenLastCalledWith({ top: 650, behavior: 'auto' })
  })
  it('无滚动距离时立即完成，不等待不会产生的 scrollend', () => {
    const viewport = page(0, 700)
    const complete = vi.fn()
    scrollArtistTabToStart(viewport, 330, 'smooth', complete)
    expect(complete).toHaveBeenCalledOnce()
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
  it('减少动画时直接定位，完成后取消不会停止新的滚动', () => {
    const viewport = page()
    const complete = vi.fn()
    const cancel = scrollArtistTabToStart(viewport, 330, 'auto', complete)
    cancel()
    expect(complete).toHaveBeenCalledOnce()
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1)
  })
})

describe('短分类切换的滚动空间', () => {
  it('列表开头仍可对齐顶栏，释放旧长列表高度不会再跳动', () => {
    expect(artistTabContentHeight(330.5, 720, 438.59375, 124)).toBe(488)
  })
  it('中断时保留当前位置，上滚时逐渐释放额外空间', () => {
    expect(artistTabContentHeight(964, 720, 438.59375, 124)).toBe(1122)
    expect(artistTabContentHeight(400, 720, 438.59375, 124)).toBe(558)
  })
  it('相似歌手回到页面顶部后完全释放，避免留下多余滚动条', () => {
    expect(artistTabContentHeight(0, 720, 438.59375, 124)).toBe(0)
  })
})
