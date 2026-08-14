import type { MusicSource } from '../../types/domain'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { NeteaseLogo, QQMusicLogo } from './brand-logos'
import { useProviderStore } from '../../stores/providers'
import type { SourceBadgeMode } from '../../lib/provider-preferences'
import { isProviderId } from '../../providers/types'
import styles from './SourceBadge.module.css'

interface SourceBadgeProps {
  source?: MusicSource
  compact?: boolean
  className?: string
  displayMode?: SourceBadgeMode
  showInactive?: boolean
  reveal?: boolean
}

export function SourceBadge({
  source,
  compact = false,
  className = '',
  displayMode,
  showInactive = false,
  reveal = false,
}: SourceBadgeProps) {
  const preference = useProviderStore((state) => state.sourceBadgeMode)
  const participating = useProviderStore((state) =>
    !source || !isProviderId(source)
      || (state.byId[source].enabled && state.byId[source].auth === 'authenticated')
  )
  const mode = displayMode ?? preference
  if (mode === 'hidden' || (!showInactive && !participating)) return null
  const dynamic = mode === 'dynamic' && !reveal
  const brand = source ? SOURCE_BRAND[source] : null
  const label = brand?.label ?? '来源未知'
  return (
    <span
      className={`${styles.badge}${dynamic ? ` ${styles.dynamic}` : ''}${compact ? ` ${styles.compact}` : ''}${className ? ` ${className}` : ''}`}
      style={{ '--source-color': brand?.color ?? '#8B8B8B' } as React.CSSProperties}
      role="img"
      aria-label={`来源：${label}`}
      title={label}
    >
      <span className={styles.icon} aria-hidden="true">
        {source === 'netease'
          ? <NeteaseLogo />
          : source === 'qq'
            ? <QQMusicLogo />
            : <span className={styles.localIcon}>{source === 'local' ? '♪' : '?'}</span>}
      </span>
      {!compact && <span className={styles.label}>{label}</span>}
    </span>
  )
}
