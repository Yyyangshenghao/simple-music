import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { SystemFontPicker } from './SystemFontPicker'

it('选中字体以当前名称显示，完整家族名保留在悬停标题', () => {
  const html = renderToStaticMarkup(<SystemFontPicker id="font" value="HarmonyOS Sans SC" fonts={[{ family: 'HarmonyOS Sans SC', localizedName: '鸿蒙黑体' }]} loading={false} onChange={vi.fn()} />)
  expect(html).toContain('title="鸿蒙黑体 · HarmonyOS Sans SC">鸿蒙黑体</span>')
  expect(html).not.toContain('>Aa</span>')
})
it('字体读取中仍保留已选名称，旧存档字体缺失也直接显示名称', () => {
  const html = renderToStaticMarkup(<SystemFontPicker id="font" value="Google Sans Code" fonts={[]} loading onChange={vi.fn()} />)
  expect(html).toContain('>Google Sans Code</span>')
  expect(html).toContain('disabled=""')
  expect(html).not.toContain('正在读取')
})
it('未指定字体时显示当前默认字体说明', () => {
  const html = renderToStaticMarkup(<SystemFontPicker id="font" value="" fonts={[]} loading={false} defaultLabel="默认：PingFang SC" onChange={vi.fn()} />)
  expect(html).toContain('>默认：PingFang SC</span>')
})
