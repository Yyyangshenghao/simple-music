import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ScrubField } from './ScrubField'

describe('拖拽数值条', () => {
  it('作为滑块呈现数值，不再提供可输入的数字框', () => {
    const html = renderToStaticMarkup(
      <ScrubField label="粒子数量" value={1} min={0.25} max={2} step={0.05} defaultValue={1} scale={100} suffix="%" onChange={vi.fn()} />,
    )
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuetext="100%"')
    expect(html).not.toContain('<input')
    expect(html).toContain('>100<')
  })
})
