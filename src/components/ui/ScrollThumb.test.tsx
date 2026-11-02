import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScrollThumb } from './ScrollThumb'

describe('自绘滚动条', () => {
  it('首帧未量到溢出时不接收指针，也不朗读', () => {
    const html = renderToStaticMarkup(<ScrollThumb target={createRef<HTMLElement>()} />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('data-overflowing="false"')
    expect(html).toContain('data-active="false"')
  })
})
