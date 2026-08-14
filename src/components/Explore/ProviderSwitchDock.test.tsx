import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderSwitchDock } from './ProviderSwitchDock'

describe('ProviderSwitchDock', () => {
  it('渲染参与平台并标记当前全局内容平台', () => {
    const html = renderToStaticMarkup(
      <ProviderSwitchDock sources={['netease', 'qq']} current="qq" onSelect={() => {}} />
    )
    expect(html).toContain('aria-label="切换内容平台"')
    expect(html).toContain('aria-label="切换到网易云"')
    expect(html).toContain('aria-label="切换到QQ音乐"')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-checked="true"')
  })

  it('不渲染聚合平台入口', () => {
    const html = renderToStaticMarkup(
      <ProviderSwitchDock sources={['netease', 'qq']} current="netease" onSelect={() => {}} />
    )
    expect(html).not.toContain('全部平台')
  })
})
