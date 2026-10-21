import { useCallback, useEffect, useReducer, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useSettingsStore } from '../../stores/settings'
import { useLyricsStore } from '../../stores/lyrics'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { CoverParticleCloud } from '../Visualizer/CoverParticleCloud'
import { FrameLimiter } from '../Visualizer/FrameLimiter'
import { StageLyrics3D } from './StageLyrics3D'
import {
  SOFT_FOCUS_IN_MS,
  SOFT_FOCUS_OUT_MS,
  SOFT_FOCUS_READY_LIMIT_MS,
  softFocusReducer,
  type SoftFocusState
} from '../../lib/soft-focus-swap'
import styles from './LyricsScene.module.css'

/** 新风格挂上后画满两帧（首帧常还在编译着色器、栅格化文字）即通知可以落定。 */
const READY_FRAMES = 2

function FirstFrameSignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0)
  useFrame(() => {
    if (frames.current > READY_FRAMES) return
    frames.current += 1
    if (frames.current === READY_FRAMES) onReady()
  })
  return null
}

/** 切换歌词风格走柔焦过渡：旧风格虚化退下，新风格画出首帧后从同样的虚化里落定。 */
function useSoftFocusSwap<T>(target: T, instant: boolean) {
  const [state, dispatch] = useReducer(
    softFocusReducer<T>,
    target,
    (initial): SoftFocusState<T> => ({ shown: initial, pending: null, phase: 'idle' })
  )
  useEffect(() => { dispatch({ type: 'change', target, instant }) }, [target, instant])
  useEffect(() => {
    const step = state.phase === 'out' ? { ms: SOFT_FOCUS_OUT_MS, type: 'outDone' as const }
      : state.phase === 'wait' ? { ms: SOFT_FOCUS_READY_LIMIT_MS, type: 'ready' as const }
      : state.phase === 'in' ? { ms: SOFT_FOCUS_IN_MS, type: 'inDone' as const }
      : null
    if (!step) return
    const timer = setTimeout(() => dispatch({ type: step.type }), step.ms)
    return () => clearTimeout(timer)
  }, [state.phase])
  const markReady = useCallback(() => dispatch({ type: 'ready' }), [])
  return { shown: state.shown, phase: state.phase, markReady }
}

/** 分镜取景框：四角框线 + 场记号（当前是第几个镜头），与场景一起虚化、落定。 */
function StoryboardFrame() {
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  return (
    <div className={styles.viewfinder} aria-hidden="true">
      <span className={`${styles.corner} ${styles.cornerTl}`} />
      <span className={`${styles.corner} ${styles.cornerTr}`} />
      <span className={`${styles.corner} ${styles.cornerBl}`} />
      <span className={`${styles.corner} ${styles.cornerBr}`} />
      <span className={styles.slate}>SC {String(Math.max(0, currentIndex) + 1).padStart(2, '0')}</span>
    </div>
  )
}

/** 仅进入 3D 模式时加载 Three.js、歌词舞台与封面粒子云。 */
export default function LyricsScene({ coverUrl, lightBackground = false }: { coverUrl?: string; lightBackground?: boolean }) {
  const style = useSettingsStore((s) => s.lyrics3dStyle)
  const fpsCap = useSettingsStore((s) => s.lyrics3d.fpsCap)
  const renderScale = useSettingsStore((s) => s.lyrics3d.renderScale)
  const reducedMotion = useReducedMotion()
  const { shown, phase, markReady } = useSoftFocusSwap(style, reducedMotion)

  return (
    <div className={styles.stage} data-phase={phase}>
      <Canvas
        camera={{ position: [0, 0, 14], fov: 60 }}
        dpr={renderScale}
        frameloop={fpsCap > 0 ? 'never' : 'always'}
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      >
        <FrameLimiter fps={fpsCap} />
        <CoverParticleCloud coverUrl={coverUrl} lightBackground={lightBackground} />
        {phase === 'wait' && <FirstFrameSignal key={shown} onReady={markReady} />}
        {shown !== 'focus' && <StageLyrics3D key={shown} lightBackground={lightBackground} style={shown} />}
      </Canvas>
      {shown === 'storyboard' && <StoryboardFrame />}
    </div>
  )
}
