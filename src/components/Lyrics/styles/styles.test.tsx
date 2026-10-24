import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PartitaLyrics } from './partita/PartitaLyrics'
import { FumeLyrics } from './fume/FumeLyrics'
import { TemperaLyrics } from './tempera/TemperaLyrics'
import { SonnetLyrics } from './sonnet/SonnetLyrics'
import { DioramaLyrics } from './diorama/DioramaLyrics'
import partitaStyles from './partita/PartitaLyrics.module.css'

// zustand 的服务端快照取初始状态，静态渲染里直接改 store 不生效，这里用可控的假 store。
const text = '今日见到的夕阳洒落漫天星点'
const h = vi.hoisted(() => ({
  lyrics: {} as Record<string, unknown>,
  settings: { lyricsShowTranslation: true, lyricsFontScale: 1, performance: { lyricsWordMotion: true } },
  tunings: {} as Record<string, Record<string, unknown>>,
}))
vi.mock('../../../stores/lyrics', () => ({ useLyricsStore: (selector: (state: object) => unknown) => selector(h.lyrics) }))
vi.mock('../../../stores/settings', () => ({ useSettingsStore: (selector: (state: object) => unknown) => selector(h.settings) }))
// 帧时钟（lyric-frame-clock）读播放器状态：不 mock 会加载真实播放器 store，而它依赖上面被 mock 掉的设置模块。
vi.mock('../../../stores/player', () => ({ usePlayerStore: { getState: () => ({ status: 'paused' }), subscribe: () => () => {} } }))
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }))
vi.mock('../../../stores/lyric-styles', async () => {
  const catalog = await vi.importActual<typeof import('../../../lib/lyric-style-catalog')>('../../../lib/lyric-style-catalog')
  return { useLyricStyleTuning: (id: 'partita' | 'fume' | 'tempera' | 'sonnet' | 'diorama') => catalog.resolveStyleTuning(id, h.tunings[id]) }
})

beforeEach(() => {
  const words = Array.from(text).map((char, i) => ({ text: char, startMs: i * 300, durationMs: 300 }))
  h.lyrics = {
    trackKey: 'local:t', currentIndex: 0,
    lines: [{ time: 10, text }, { time: 16, text: '下一句' }],
    wordLines: [{ time: 10, durationMs: 4000, words }],
    translation: [{ time: 10, text: '今日所见的夕阳' }],
  }
  h.tunings = {}
})

const count = (html: string, className: string) => html.split(className).length - 1

describe('动态样式渲染', () => {
  it('云阶：多行台阶带引导线与错位；关闭引导线后不带', () => {
    const html = renderToStaticMarkup(<PartitaLyrics />)
    expect(count(html, partitaStyles.guided)).toBeGreaterThan(1)
    expect(html).toMatch(/translateX\(-?\d/)
    h.tunings.partita = { guides: false }
    expect(renderToStaticMarkup(<PartitaLyrics />)).not.toContain(partitaStyles.guided)
  })

  it('间奏或无歌词时不渲染任何词', () => {
    h.lyrics = { ...h.lyrics, currentIndex: -1 }
    expect(renderToStaticMarkup(<PartitaLyrics />)).not.toContain('夕阳')
  })

  it('拼版：DOM 排出整首歌，当前句逐字成字、留给读屏，主舞台显示译文而预览不显示', () => {
    const html = renderToStaticMarkup(<FumeLyrics />)
    expect(html).not.toContain('<canvas')
    expect(html).toContain(text)
    expect(html).toContain('下一句')
    expect(count(html, 'data-glyph=')).toBe(Array.from(text).length)
    expect(html).toContain('今日所见的夕阳')
    expect(renderToStaticMarkup(<FumeLyrics preview />)).not.toContain('今日所见的夕阳')
  })

  it('凝彩：画布渲染，当前句留给读屏，主舞台显示译文而预览不显示', () => {
    const html = renderToStaticMarkup(<TemperaLyrics />)
    expect(html).toContain('<canvas')
    expect(html).toContain(text)
    expect(html).toContain('今日所见的夕阳')
    expect(renderToStaticMarkup(<TemperaLyrics preview />)).not.toContain('今日所见的夕阳')
  })

  it('商籁：画布渲染，当前句留给读屏，主舞台显示译文而预览不显示', () => {
    const html = renderToStaticMarkup(<SonnetLyrics />)
    expect(html).toContain('<canvas')
    expect(html).toContain(text)
    expect(html).toContain('今日所见的夕阳')
    expect(renderToStaticMarkup(<SonnetLyrics preview />)).not.toContain('今日所见的夕阳')
  })

  it('镜台：画布渲染，当前句留给读屏，主舞台显示译文而预览不显示', () => {
    const html = renderToStaticMarkup(<DioramaLyrics />)
    expect(html).toContain('<canvas')
    expect(html).toContain(text)
    expect(html).toContain('今日所见的夕阳')
    expect(renderToStaticMarkup(<DioramaLyrics preview />)).not.toContain('今日所见的夕阳')
  })
})
