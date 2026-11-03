import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { OfflineMusicTab } from './OfflineMusicTab'

it('已下载保留下载队列入口，目录按钮紧邻设置左侧', () => {
  const html = renderToStaticMarkup(<OfflineMusicTab scrollRef={{ current: null }} />)
  expect(html).toContain('aria-label="下载队列"')
  expect(html.indexOf('aria-label="打开下载文件夹"')).toBeLessThan(html.indexOf('aria-label="下载设置"'))
  expect(html).not.toContain('保存到本地')
  expect(html).not.toContain('取消固定')
})
