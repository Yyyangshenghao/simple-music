import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { InfoButton } from './InfoButton'

vi.mock('../../stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ performance: { textRevealMotion: true } }),
}))

describe('ⓘ 说明', () => {
  it('收起时不挂载示意与逐字节点，只留一份说明文字供辅助技术读取', () => {
    const html = renderToStaticMarkup(<InfoButton label="动效" text="逐字说明" preview={<i data-effect="demo" />} />)
    expect(html).not.toContain('data-effect')
    expect(html).not.toContain('--reveal-delay')
    expect(html).toContain('逐字说明')
    expect(html).toContain('data-open="false"')
    expect(html).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"/)
  })
})
