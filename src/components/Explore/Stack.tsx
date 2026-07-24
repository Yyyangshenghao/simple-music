import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import type { PanInfo } from 'motion/react'
import type { Playlist } from '../../types/domain'
import styles from './Stack.module.css'
import { sizedImage } from '../../lib/image-size'

/** 拖拽甩卡阈值（px），超过即视为把顶卡甩出。 */
const SENSITIVITY = 170

interface CardRotateProps {
  children: ReactNode
  active: boolean
  reduced: boolean
  onSwipe(): void
}

/** 顶卡拖拽层：跟手位移 + 3D 旋转（reduced-motion 时仅位移），超阈值甩出。 */
function CardRotate({ children, active, reduced, onSwipe }: CardRotateProps) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useTransform(y, [-100, 100], [60, -60])
  const rotateY = useTransform(x, [-100, 100], [-60, 60])

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (Math.abs(info.offset.x) > SENSITIVITY || Math.abs(info.offset.y) > SENSITIVITY) {
      onSwipe()
    }
    x.set(0)
    y.set(0)
  }

  // 受控模式下只有顶卡可拖：非顶卡拖拽会错甩掉顶卡
  if (!active) {
    return <div className={styles.cardStatic}>{children}</div>
  }

  return (
    <motion.div
      className={styles.cardRotate}
      style={reduced ? { x, y } : { x, y, rotateX, rotateY }}
      drag
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragElastic={0.6}
      whileTap={{ cursor: 'grabbing' }}
      onDragEnd={handleDragEnd}
    >
      {children}
    </motion.div>
  )
}

interface StackProps {
  /** 顶卡在数组末位（后渲染者在上层）。 */
  cards: Playlist[]
  onSwipe(): void
  onCardClick(playlist: Playlist): void
}

export function Stack({ cards, onSwipe, onCardClick }: StackProps) {
  const reduced = useReducedMotion() ?? false
  // 每张卡固定一个 -3°~3° 的"杂乱角"，按 id 记忆，重渲染不跳动
  const rotations = useRef(new Map<unknown, number>())

  function messyAngle(id: unknown): number {
    if (reduced) return 0
    let angle = rotations.current.get(id)
    if (angle === undefined) {
      angle = Math.random() * 6 - 3
      rotations.current.set(id, angle)
    }
    return angle
  }

  return (
    <div className={styles.stackContainer}>
      {cards.map((pl, index) => {
        const isTop = index === cards.length - 1
        return (
          <CardRotate key={String(pl.id)} active={isTop} reduced={reduced} onSwipe={onSwipe}>
            <motion.div
              className={styles.card}
              onTap={isTop ? () => onCardClick(pl) : undefined}
              animate={{
                rotateZ: (cards.length - index - 1) * 4 + messyAngle(pl.id),
                scale: 1 + index * 0.06 - cards.length * 0.06,
                transformOrigin: '90% 90%',
              }}
              initial={false}
              transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 20 }}
            >
              {pl.cover
                ? <img className={styles.cover} src={sizedImage(pl.cover, 520)} alt="" draggable={false} loading="lazy" />
                : <div className={styles.coverFallback} />}
              <div className={styles.nameOverlay}>{pl.name}</div>
            </motion.div>
          </CardRotate>
        )
      })}
    </div>
  )
}
