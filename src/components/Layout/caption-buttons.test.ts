import { expect, it } from 'vitest'
import { drawsCaptionButtons } from './caption-buttons'

// 这个判断同时决定 WindowChrome 画不画按钮、TopBar 留不留占位；两侧必须一致，
// 否则 Linux 上关闭按钮会压住顶栏头像。
it.each([
  ['win32', true],
  ['linux', true],
  ['darwin', false],
  [undefined, false],
  ['', false]
])('%s 平台自绘窗口按钮：%s', (platform, expected) => {
  expect(drawsCaptionButtons(platform)).toBe(expected)
})
