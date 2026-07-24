import { motion } from 'motion/react'
import type { MusicSource } from '../../types/domain'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { springSnappy } from '../../lib/motion-presets'
import { NeteaseLogo, QQMusicLogo } from './brand-logos'
import styles from './SourceAvatar.module.css'
import { sizedImage } from '../../lib/image-size'

interface SourceAvatarProps {
  source: MusicSource
  avatarUrl: string
}

/** 头像角标：右下角叠加官方品牌图标，随 activeSource 切换告知当前音源。 */
function BrandBadge({ source }: { source: MusicSource }) {
  const Logo = source === 'netease' ? NeteaseLogo : QQMusicLogo
  return (
    <span className={styles.badge} aria-hidden="true">
      <Logo className={styles.badgeLogo} />
    </span>
  )
}

/** 顶栏头像：按当前音源显示真实头像（已登录）/ 通用图标（未登录），叠加品牌角标与光晕，切源时弹入。 */
export function SourceAvatar({ source, avatarUrl }: SourceAvatarProps) {
  const brand = SOURCE_BRAND[source]
  return (
    <motion.span
      key={source}
      className={styles.root}
      style={{ '--brand-glow': brand.colorSoft } as React.CSSProperties}
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springSnappy}
      title={brand.label}
    >
      {avatarUrl ? (
        <img className={styles.photo} src={sizedImage(avatarUrl, 88)} alt="" loading="lazy" />
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5c1.6-3.4 4.3-5 7.5-5s5.9 1.6 7.5 5" />
        </svg>
      )}
      <BrandBadge source={source} />
    </motion.span>
  )
}
