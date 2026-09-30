import type { MusicSource } from '../../types/domain'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { AppleLogo } from './brand-logos'
import styles from './SourceName.module.css'

export function SourceName({ source }: { source: MusicSource }) {
  if (source !== 'apple') return SOURCE_BRAND[source].label
  return <span className={styles.apple}><AppleLogo />Music</span>
}
