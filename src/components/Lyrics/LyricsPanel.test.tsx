import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LyricsPanel } from './LyricsPanel'
import styles from './LyricsPanel.module.css'

const scene = vi.hoisted(() => ({ loads: 0 }))
const settings = vi.hoisted(() => ({ mode: 'lyrics' as 'lyrics' | 'dynamic', enabled: true, theme: 'dark' as 'light' | 'dark' }))

vi.mock('./LyricsScene', () => {
  scene.loads += 1
  return { default: ({ lightBackground }: { lightBackground: boolean }) => <div data-testid="lyrics-scene" data-light-background={lightBackground} /> }
})
// 动态样式选 3D 舞台；3D 被设置关闭时回落跃字，同样不应加载场景。
vi.mock('../../stores/lyric-styles', () => ({
  useLyricStylesStore: (selector: (value: { style: string }) => unknown) => selector({ style: 'stage3d' }),
  useLyricStyleTuning: () => ({ intensity: 1, camera: true }),
}))
vi.mock('../../stores/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  return {
    ...original,
    useSettingsStore: Object.assign((selector: (value: unknown) => unknown) => {
      const state = original.useSettingsStore.getState()
      return selector({
        ...state,
        lyricsPanelMode: settings.mode,
        themeMode: settings.theme,
        performance: { ...state.performance, lyrics3dEnabled: settings.enabled }
      })
    }, original.useSettingsStore)
  }
})

describe('歌词场景按需加载', () => {
  it('关闭、纯歌词和禁用 3D 时均不加载，打开 3D 舞台样式才加载场景', async () => {
    const render = (open: boolean) => renderToStaticMarkup(<LyricsPanel open={open} onClose={vi.fn()} />)

    settings.mode = 'dynamic'
    render(false)
    settings.mode = 'lyrics'
    const ordinary = render(true)
    expect(ordinary).toContain('暂无歌词')
    expect(ordinary).toContain('aria-label="歌词播放控制"')
    expect(ordinary).not.toContain('aria-label="查看歌词"')
    expect(render(false)).not.toContain('aria-label="歌词播放控制"')
    settings.mode = 'dynamic'
    settings.enabled = false
    expect(render(true)).not.toContain('data-testid="lyrics-scene"')
    await vi.dynamicImportSettled()
    expect(scene.loads).toBe(0)

    settings.enabled = true
    render(true)
    await vi.dynamicImportSettled()
    expect(scene.loads).toBe(1)
    expect(render(true)).toContain('data-testid="lyrics-scene"')
    expect(render(true)).not.toContain('aria-label="歌词播放控制"')
    expect(render(true)).not.toContain(styles.lightScene)
    expect(render(true)).toContain('data-light-background="false"')
    settings.theme = 'light'
    expect(render(true)).toContain(styles.lightScene)
    expect(render(true)).toContain('data-light-background="true"')
    settings.theme = 'dark'
    expect(render(false)).not.toContain('data-testid="lyrics-scene"')
    settings.mode = 'lyrics'
    expect(render(true)).not.toContain('data-testid="lyrics-scene"')
  })
})
