import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { OfflineMusicTab } from './OfflineMusicTab'

it('离线音乐保留下载队列入口，目录按钮紧邻设置左侧', () => {
  const html = renderToStaticMarkup(<OfflineMusicTab scrollRef={{ current: null }} />)
  expect(html).toContain('aria-label="下载队列"')
  expect(html.indexOf('aria-label="打开离线音乐文件夹"')).toBeLessThan(html.indexOf('aria-label="离线音乐设置"'))
  expect(html).not.toContain('保存到本地')
  expect(html).not.toContain('取消固定')
})
