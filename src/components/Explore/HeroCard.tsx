import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import { springGentle } from '../../lib/motion-presets'
import styles from './HeroCard.module.css'
import { sizedImage } from '../../lib/image-size'

interface HeroCardProps {
  title: string
  subtitle: string
  cover?: string
  /** 左上角徽标（每日推荐的日历数字）。 */
  badge?: ReactNode
  /** 传入时封面参与共享元素转场（与详情页头部封面同 ID）。 */
  layoutId?: string
  onClick(): void
}

export function HeroCard({ title, subtitle, cover, badge, layoutId, onClick }: HeroCardProps) {
  return (
    <TiltCard className={styles.wrap}>
      <BorderGlow borderRadius={16}>
        <button className={`${styles.card} no-drag`} onClick={onClick}>
          <motion.div className={styles.coverWrap} layoutId={layoutId} transition={springGentle}>
            {cover
              ? <img className={styles.cover} src={sizedImage(cover, 320)} alt="" loading="lazy" />
              : <div className={styles.coverFallback} />}
          </motion.div>
          <div className={styles.scrim} />
          {badge && <div className={styles.badge}>{badge}</div>}
          <div className={styles.text}>
            <p className={styles.title}>{title}</p>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
        </button>
      </BorderGlow>
    </TiltCard>
  )
}
