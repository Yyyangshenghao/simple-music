import type { CSSProperties } from 'react'
import type { PerformanceFlags } from '../../types/domain'
import styles from './EffectPreview.module.css'

export type PreviewEffect = Extract<keyof PerformanceFlags,
  'textRevealMotion' | 'lyricsWordMotion' | 'cardTiltEffect' | 'cardSpotlightEffect'
  | 'gradientTextMotion' | 'audioGlowEffect' | 'bgFluidMotion' | 'bgPointerMotion'>

const REVEAL_TEXT = '简介和说明逐字淡入'

function MiniCard({ spotlight = false }: { spotlight?: boolean }) {
  return (
    <span className={styles.card}>
      <span className={styles.cover} />
      <span className={styles.lines}><i /><i /></span>
      {spotlight && <span className={styles.spot} />}
    </span>
  )
}

/** 设置页 ⓘ 里的动效示意：纯 CSS 循环小样，仅在说明展开时播放。 */
export function EffectPreview({ effect }: { effect: PreviewEffect }) {
  return (
    <span className={styles.stage} data-effect={effect} aria-hidden="true">
      {effect === 'textRevealMotion' && <span className={styles.reveal}>
        {[...REVEAL_TEXT].map((char, index) => <span key={index} style={{ '--i': index } as CSSProperties}>{char}</span>)}
      </span>}
      {effect === 'lyricsWordMotion' && <span className={styles.lyric}>
        <span className={styles.lyricDim}>晴天的风吹过窗前</span>
        <span className={styles.lyricLit}>晴天的风吹过窗前</span>
      </span>}
      {effect === 'cardTiltEffect' && <span className={styles.tilt}><MiniCard /></span>}
      {effect === 'cardSpotlightEffect' && <MiniCard spotlight />}
      {effect === 'gradientTextMotion' && <span className={styles.gradientTitle}>为你推荐</span>}
      {effect === 'audioGlowEffect' && <span className={styles.bar}>
        <span className={styles.cover} />
        <span className={styles.lines}><i /><i /></span>
        <span className={styles.play} />
      </span>}
      {(effect === 'bgFluidMotion' || effect === 'bgPointerMotion') && <span className={styles.fluid} data-follow={effect === 'bgPointerMotion'}>
        <span className={styles.blobA} />
        <span className={styles.blobB} />
        <span className={styles.blobC} />
      </span>}
      {(effect === 'cardTiltEffect' || effect === 'cardSpotlightEffect' || effect === 'bgPointerMotion') && <span className={styles.cursor} />}
    </span>
  )
}
