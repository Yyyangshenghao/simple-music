import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion, useAnimate } from 'motion/react'
import { useMotion } from '../../hooks/useMotion'
import { heartBeatMinScale, heartBeatTransition, heartBurstTransition } from '../../lib/motion-presets'
import styles from './HeartIcon.module.css'

const HEART_PATH = 'M12 20.1c-.21 0-.42-.07-.59-.21C6.43 15.86 3 12.78 3 9.03 3 6.3 5.08 4.25 7.68 4.25c1.74 0 3.3.9 4.32 2.33 1.02-1.43 2.58-2.33 4.32-2.33 2.6 0 4.68 2.05 4.68 4.78 0 3.75-3.43 6.83-8.41 10.86-.17.14-.38.21-.59.21z'

/** 点击后多久内的状态变化算用户操作；切歌、异步查询带来的变化不播心跳。 */
const CLICK_WINDOW_MS = 400

/** 粒子：外圈 8 颗大点 + 错开 22.5° 的内圈 8 颗小点，单位为 viewBox 坐标。 */
const PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const outer = i % 2 === 0
  const angle = ((i * 22.5 - 90) * Math.PI) / 180
  const from = outer ? 7 : 6
  const to = outer ? 15 : 12
  return {
    cx: 12 + Math.cos(angle) * from,
    cy: 12 + Math.sin(angle) * from,
    dx: Math.cos(angle) * (to - from),
    dy: Math.sin(angle) * (to - from),
    r: outer ? 1.4 : 0.9
  }
})

/**
 * 红心图标:filled 时纯色实心,否则细描边;颜色取自 currentColor。
 * 用户点击所在按钮引起的切换播一次心跳(收缩→回弹,填充在最低点切换),点亮时附带粒子迸散;
 * 首次挂载与非点击引起的变化(切歌、异步核对)不播。供 PlayerBar / TrackRow 等红心按钮复用。
 */
export function HeartIcon({ filled, size = 17 }: { filled: boolean; size?: number }) {
  const reducedMotion = !useMotion('iconMotion')
  const [scope, animate] = useAnimate<SVGGElement>()
  const clickedAt = useRef(-Infinity)
  const [prevFilled, setPrevFilled] = useState(filled)
  const [beat, setBeat] = useState<{ id: number; burst: boolean } | null>(null)
  const [beating, setBeating] = useState(false)

  // 渲染期比较上一帧:与 filled 的翻转同一次提交里挂上 data-beating,填充才能延到收缩最低点。
  if (prevFilled !== filled) {
    setPrevFilled(filled)
    if (!reducedMotion && performance.now() - clickedAt.current < CLICK_WINDOW_MS) {
      setBeat((b) => ({ id: (b?.id ?? 0) + 1, burst: filled }))
      setBeating(true)
    }
  }

  useEffect(() => {
    const button = scope.current?.closest('button')
    if (!button) return
    const onClick = () => { clickedAt.current = performance.now() }
    button.addEventListener('click', onClick, true)
    return () => button.removeEventListener('click', onClick, true)
  }, [scope])

  useEffect(() => {
    if (!beat || !scope.current) return
    const controls = animate(scope.current, { scale: [1, heartBeatMinScale, 1] }, heartBeatTransition)
    // 只收起填充延迟;粒子留在原地(终态透明),下次心跳换 key 重播,避免缩放先结束时把粒子截断。
    let current = true
    controls.then(() => { if (current) setBeating(false) })
    return () => { current = false; controls.stop() }
  }, [beat, animate, scope])

  const swapDelay = heartBeatTransition.duration * heartBeatTransition.times[1]

  return (
    <svg
      className={styles.heart}
      data-filled={filled}
      data-beating={beating || undefined}
      style={{ '--heart-swap-delay': `${swapDelay}s` } as CSSProperties}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <g ref={scope}>
        <path d={HEART_PATH} transform="translate(-1.08 -0.96) scale(1.09)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      {beat?.burst && (
        <g key={beat.id} fill="currentColor">
          {PARTICLES.map((p, i) => (
            <motion.circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
              animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 0], scale: 0.2 }}
              transition={heartBurstTransition}
            />
          ))}
        </g>
      )}
    </svg>
  )
}
