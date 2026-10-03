import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LyricsPanel } from './LyricsPanel'

const scene = vi.hoisted(() => ({ loads: 0 }))
const settings = vi.hoisted(() => ({ mode: 'lyrics' as 'lyrics' | '3d', enabled: true }))

vi.mock('./LyricsScene', () => {
  scene.loads += 1
  return { default: () => <div data-testid="lyrics-scene" /> }
})
vi.mock('../../stores/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  return {
    ...original,
    useSettingsStore: Object.assign((selector: (value: unknown) => unknown) => {
      const state = original.useSettingsStore.getState()
      return selector({
        ...state,
        lyricsPanelMode: settings.mode,
        performance: { ...state.performance, lyrics3dEnabled: settings.enabled }
      })
    }, original.useSettingsStore)
  }
})

describe('歌词场景按需加载', () => {
  it('关闭、纯歌词和禁用 3D 时均不加载，打开 3D 才加载场景', async () => {
    const render = (open: boolean) => renderToStaticMarkup(<LyricsPanel open={open} onClose={vi.fn()} />)

    settings.mode = '3d'
    render(false)
    settings.mode = 'lyrics'
    expect(render(true)).toContain('暂无歌词')
    settings.mode = '3d'
    settings.enabled = false
    expect(render(true)).toContain('暂无歌词')
    await vi.dynamicImportSettled()
    expect(scene.loads).toBe(0)

    settings.enabled = true
    render(true)
    await vi.dynamicImportSettled()
    expect(scene.loads).toBe(1)
    expect(render(true)).toContain('data-testid="lyrics-scene"')
    expect(render(false)).not.toContain('data-testid="lyrics-scene"')
    settings.mode = 'lyrics'
    expect(render(true)).not.toContain('data-testid="lyrics-scene"')
  })
})
