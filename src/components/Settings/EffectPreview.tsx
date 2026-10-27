import type { CSSProperties } from 'react'
import type { PerformanceFlags } from '../../types/domain'
import styles from './EffectPreview.module.css'

export type PreviewEffect = Extract<keyof PerformanceFlags,
  'textRevealMotion' | 'lyricsWordMotion' | 'cardTiltEffect' | 'cardSpotlightEffect'
  | 'gradientTextMotion' | 'audioGlowEffect' | 'bgFluidMotion' | 'bgPointerMotion'
  | 'pageTransitionMotion' | 'smoothScrollMotion' | 'lyricsLineMotion'
  | 'tapFeedbackMotion' | 'hoverLiftMotion' | 'toggleMotion' | 'indicatorMotion' | 'sliderMotion' | 'dragMotion' | 'iconMotion' | 'popoverSproutMotion'>

const LYRIC_LINES = ['故事的小黄花', '从出生那年就飘着', '童年的荡秋千', '随记忆一直晃到现在']

function MiniPage({ className }: { className: string }) {
  return (
    <span className={`${styles.page} ${className}`}>
      <i className={styles.pageTitle} />
      <span className={styles.pageGrid}><i /><i /><i /></span>
    </span>
  )
}

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
      {effect === 'pageTransitionMotion' && <span className={styles.pages}>
        <MiniPage className={styles.pageOut} />
        <MiniPage className={styles.pageIn} />
      </span>}
      {effect === 'toggleMotion' && <span className={styles.toggle}><span className={styles.toggleThumb} /></span>}
      {effect === 'tapFeedbackMotion' && <span className={styles.tapButton}>播放全部</span>}
      {effect === 'hoverLiftMotion' && <span className={styles.hoverLift}><MiniCard /></span>}
      {effect === 'indicatorMotion' && <span className={styles.tabs}>
        <span className={styles.tabPill} />
        <span>歌单</span><span>专辑</span><span>歌手</span>
      </span>}
      {effect === 'sliderMotion' && <span className={styles.slider}>
        <span className={styles.sliderRail}><span className={styles.sliderFill} /></span>
        <span className={styles.sliderThumb}><span className={styles.sliderBubble} /></span>
      </span>}
      {effect === 'dragMotion' && <span className={styles.dragList}>
        <i /><i className={styles.dragRow} /><i />
      </span>}
      {effect === 'iconMotion' && <span className={styles.heart}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
        {Array.from({ length: 6 }, (_, index) => <i key={index} style={{ '--i': index } as CSSProperties} />)}
      </span>}
      {effect === 'popoverSproutMotion' && <span className={styles.sprout}>
        <span className={styles.sproutShape}><i /><i /><i /></span>
        <span className={styles.sproutMic} />
      </span>}
      {effect === 'smoothScrollMotion' && <span className={styles.scrollView}>
        <span className={styles.scrollList}>{Array.from({ length: 8 }, (_, index) => <i key={index} data-target={index === 5 || undefined} />)}</span>
      </span>}
      {effect === 'lyricsLineMotion' && <span className={styles.lineView}>
        <span className={styles.lineList}>{LYRIC_LINES.map((text, index) => <span key={text} style={{ '--i': index } as CSSProperties}>{text}</span>)}</span>
      </span>}
      {(effect === 'bgFluidMotion' || effect === 'bgPointerMotion') && <span className={styles.fluid} data-follow={effect === 'bgPointerMotion'}>
        <span className={styles.blobA} />
        <span className={styles.blobB} />
        <span className={styles.blobC} />
      </span>}
      {(effect === 'cardTiltEffect' || effect === 'cardSpotlightEffect' || effect === 'bgPointerMotion') && <span className={styles.cursor} />}
      {(effect === 'tapFeedbackMotion' || effect === 'hoverLiftMotion' || effect === 'dragMotion') && <span className={styles.pointer} data-effect={effect} />}
    </span>
  )
}
