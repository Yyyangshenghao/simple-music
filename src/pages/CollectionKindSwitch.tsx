import { JellyRadio, type JellyRadioItem } from '../components/ui/JellyRadio'
import styles from './CollectionKindSwitch.module.css'

export type CollectionKind = 'collected' | 'albums'

const icon = (paths: JSX.Element) => (
  <svg className={styles.icon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
)

const OPTIONS: JellyRadioItem<CollectionKind>[] = [
  { value: 'collected', label: '歌单', icon: icon(<path d="M4 6h11M4 11h11M4 16h6M17.5 18.5V9.5l3 1.2M17.5 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />) },
  { value: 'albums', label: '专辑', icon: icon(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.4" /></>) },
]

/** 收藏页内的二级切换：果冻单选，选中项为实体玻璃片；不使用强调色以免与主导航争层级。 */
export function CollectionKindSwitch({ value, onChange }: { value: CollectionKind; onChange(value: CollectionKind): void }) {
  return <JellyRadio className={styles.radio} items={OPTIONS} value={value} onChange={onChange} ariaLabel="收藏类型" />
}
