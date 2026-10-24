import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScrubSlider } from './ScrubSlider'

describe('ScrubSlider 静态渲染', () => {
  it('暴露 slider 语义与当前比例，气泡默认隐藏', () => {
    const html = renderToStaticMarkup(
      <ScrubSlider ariaLabel="播放进度" value={30} max={120} format={(v) => `${v}s`} onChange={() => {}} />
    )
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuenow="30"')
    expect(html).toContain('aria-valuetext="30s"')
    expect(html).toContain('--scrub-ratio:0.25')
    expect(html).not.toContain('data-visible')
  })

  it('禁用时标记 aria-disabled，值越界时比例夹在 0–1', () => {
    const html = renderToStaticMarkup(<ScrubSlider ariaLabel="音量" value={2} max={1} disabled onChange={() => {}} />)
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('--scrub-ratio:1')
  })
})
