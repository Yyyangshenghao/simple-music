import { expect, it } from 'vitest'
import { hoverTipPosition, hoverTipText } from './hover-tip'

it('顶部工具栏的提示翻转到按钮下方，播放栏提示保持在按钮上方', () => {
  expect(hoverTipPosition({ cx: 200, top: 6, bottom: 38 }, { width: 100, height: 24 }, { width: 960, height: 680 }))
    .toEqual({ left: 150, top: 46, below: true })
  expect(hoverTipPosition({ cx: 200, top: 620, bottom: 652 }, { width: 100, height: 24 }, { width: 960, height: 680 }))
    .toEqual({ left: 150, top: 588, below: false })
})

it('左右边缘及多行长提示保持在视口安全区内', () => {
  expect(hoverTipPosition({ cx: 8, top: 60, bottom: 92 }, { width: 320, height: 72 }, { width: 960, height: 680 }))
    .toEqual({ left: 8, top: 100, below: true })
  expect(hoverTipPosition({ cx: 950, top: 600, bottom: 632 }, { width: 320, height: 72 }, { width: 960, height: 680 }))
    .toEqual({ left: 632, top: 520, below: false })
})

it('禁用动作展示不可用原因，不能被通用动作名称覆盖', () => {
  expect(hoverTipText({ disabled: true, tip: '下一首播放', title: '单曲循环时不会自动切歌', label: '下一首播放' })).toBe('单曲循环时不会自动切歌')
  expect(hoverTipText({ disabled: false, tip: '下一首播放', title: '其他说明' })).toBe('下一首播放')
})
