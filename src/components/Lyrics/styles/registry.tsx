import type { ComponentType, ReactNode } from 'react'
import type { LyricStyleId } from '../../../lib/lyric-style-catalog'
import { PopLyrics } from '../PopLyrics'
import { Stage3dSettings } from '../EffectSwitcher'
import { LuminousLyrics } from './luminous/LuminousLyrics'
import { TiltLyrics } from './tilt/TiltLyrics'
import { PartitaLyrics } from './partita/PartitaLyrics'
import { FumeLyrics } from './fume/FumeLyrics'
import { TemperaLyrics } from './tempera/TemperaLyrics'
import { LumiereLyrics } from './lumiere/LumiereLyrics'
import { SonnetLyrics } from './sonnet/SonnetLyrics'
import { DioramaLyrics } from './diorama/DioramaLyrics'

/**
 * 动态歌词样式的渲染侧登记，与 lib/lyric-style-catalog 的纯数据按 id 对应。
 * - Stage：歌词页舞台。挂在铺满面板的尺寸容器里，样式内部用 cqw/cqh 排版。
 *   3D 舞台带全屏场景与遮罩，由歌词页单独挂载，这里不登记 Stage。
 * - Preview：选择器卡片里的缩略实时预览（catalog 里 preview 为 live 才会用到）。
 * - Settings：自带设置面板；未提供时按 catalog 的参数声明生成。
 * - glyph：卡片示意图，重型样式与预览不可用时显示。
 */
export interface LyricStyleView {
  Stage?: ComponentType
  Preview?: ComponentType
  Settings?: ComponentType
  glyph: ReactNode
}

const glyph = (children: ReactNode) => (
  <svg viewBox="0 0 64 40" width="64" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const LYRIC_STYLE_VIEWS: Record<LyricStyleId, LyricStyleView> = {
  pop: {
    Stage: () => <PopLyrics />,
    Preview: () => <PopLyrics preview />,
    glyph: glyph(<><path d="M14 24l6-10 6 10" /><path d="M30 26V12h6a4 4 0 0 1 0 8h-6" /><path d="M44 14h8M48 14v12" opacity=".6" /></>),
  },
  luminous: {
    Stage: () => <LuminousLyrics />,
    Preview: () => <LuminousLyrics preview />,
    glyph: glyph(<><circle cx="22" cy="20" r="7" opacity=".5" /><path d="M14 22h6M30 16h8M42 24h8" /></>),
  },
  tilt: {
    Stage: () => <TiltLyrics />,
    Preview: () => <TiltLyrics preview />,
    glyph: glyph(<><path d="M18 15h28" /><path d="M20 28l4-6M30 30l4-6M40 28l4-6" opacity=".7" /></>),
  },
  partita: {
    Stage: () => <PartitaLyrics />,
    Preview: () => <PartitaLyrics preview />,
    glyph: glyph(<><path d="M12 12h18M24 22h18M16 32h18" /><path d="M32 10v4M44 20v4M36 30v4" opacity=".6" /></>),
  },
  fume: {
    Stage: () => <FumeLyrics />,
    Preview: () => <FumeLyrics preview />,
    glyph: glyph(<><path d="M10 12h16M10 18h14M10 24h12" opacity=".5" /><path d="M34 20h14" /><rect x="49" y="15" width="4" height="7" /></>),
  },
  tempera: {
    Stage: () => <TemperaLyrics />,
    Preview: () => <TemperaLyrics preview />,
    glyph: glyph(<><path d="M6 26 L58 14 L58 38 L6 38 Z" opacity=".45" /><circle cx="44" cy="12" r="6" /><path d="M14 20h18" /></>),
  },
  lumiere: {
    Stage: () => <LumiereLyrics />,
    Preview: () => <LumiereLyrics preview />,
    glyph: glyph(<><path d="M20 2 L10 38 M20 2 L30 38" opacity=".45" /><path d="M14 26h30" /><path d="M48 10l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" /></>),
  },
  sonnet: {
    Stage: () => <SonnetLyrics />,
    Preview: () => <SonnetLyrics preview />,
    glyph: glyph(<><circle cx="40" cy="20" r="13" opacity=".45" /><path d="M14 8v24" strokeWidth="4" /><path d="M22 16h10M22 24h8" /><path d="M4 4h5M4 4v5M60 36h-5M60 36v-5" /></>),
  },
  diorama: {
    Stage: () => <DioramaLyrics />,
    glyph: glyph(<><path d="M4 36 Q20 20 32 24 T60 8" opacity=".5" /><path d="M14 30l10-3M30 22l10-3M44 16l9-3" /><circle cx="50" cy="30" r="4" opacity=".6" /></>),
  },
  stage3d: {
    Settings: Stage3dSettings,
    glyph: glyph(<><path d="M10 28l22-10 22 10-22 8z" opacity=".55" /><path d="M18 16h28M22 10h20" /><circle cx="14" cy="8" r="1.2" /><circle cx="52" cy="12" r="1" /></>),
  },
}
