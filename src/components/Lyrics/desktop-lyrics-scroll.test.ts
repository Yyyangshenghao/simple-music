import { expect, it, vi } from 'vitest'
import { canScrollDesktopLyrics, scrollDesktopLyrics, type DesktopLyricsScrollFrame } from './desktop-lyrics-scroll'

const previous: DesktopLyricsScrollFrame = { trackKey: 'local:1', lineIndex: 0, double: true, line: '第一句', nextLine: '第二句' }
const current: DesktopLyricsScrollFrame = { ...previous, lineIndex: 1, line: '第二句', nextLine: '第三句' }

it('只有同曲双行的下一句成为当前句时滚动，末句和重复文本同样可滚动', () => {
  expect(canScrollDesktopLyrics(previous, current)).toBe(true)
  expect(canScrollDesktopLyrics(previous, { ...current, nextLine: '' })).toBe(true)
  expect(canScrollDesktopLyrics({ ...previous, line: '第二句' }, current)).toBe(true)
})

it.each([
  [null, current],
  [previous, { ...current, trackKey: 'local:2' }],
  [previous, { ...current, lineIndex: 3 }],
  [current, previous],
  [previous, { ...current, double: false }],
  [{ ...previous, double: false }, current],
  [{ ...previous, lineIndex: -1 }, current],
  [previous, { ...current, line: '其他歌词' }],
  [previous, { ...previous }]
])('首次显示、切歌、跳播、占位或切换单行时直接更新：%j → %j', (before, after) => {
  expect(canScrollDesktopLyrics(before, after!)).toBe(false)
})

function row() {
  const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null }
  const element = { textContent: '', animate: vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation) }
  return { element: element as unknown as HTMLElement, animate: element.animate, animation }
}

it('旧句上滑离开，新当前句与下一句从下方进入，结束后清除退出文字', () => {
  const outgoing = row(), active = row(), next = row()
  const cleanup = scrollDesktopLyrics(outgoing.element, active.element, next.element, '第一句', 52)
  expect(outgoing.element.textContent).toBe('第一句')
  expect(outgoing.animate.mock.calls[0][0]).toEqual([
    { transform: 'translateY(0px)', opacity: 1 }, { transform: 'translateY(-52px)', opacity: 0 }
  ])
  expect(active.animate.mock.calls[0][0]).toEqual([
    { transform: 'translateY(52px)', opacity: 0.62 }, { transform: 'translateY(0px)', opacity: 1 }
  ])
  expect(next.animate.mock.calls[0][0]).toEqual([
    { transform: 'translateY(52px)', opacity: 0 }, { transform: 'translateY(0px)', opacity: 1 }
  ])
  outgoing.animation.onfinish?.()
  expect(outgoing.element.textContent).toBe('')
  cleanup()
  for (const target of [outgoing, active, next]) expect(target.animation.cancel).toHaveBeenCalledOnce()
})

it('快速更新和卸载时取消滚动并清空退出文字，末句不要求下一行节点', () => {
  const outgoing = row(), active = row()
  const cleanup = scrollDesktopLyrics(outgoing.element, active.element, null, '第一句', 52)
  cleanup()
  expect(outgoing.element.textContent).toBe('')
  expect(outgoing.animation.onfinish).toBeNull()
  expect(outgoing.animation.cancel).toHaveBeenCalledOnce()
  expect(active.animation.cancel).toHaveBeenCalledOnce()
})
