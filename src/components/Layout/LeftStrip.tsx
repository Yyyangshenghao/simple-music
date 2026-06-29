// src/components/Layout/LeftStrip.tsx
import { NavModule } from './modules/NavModule'
import { SearchModule } from './modules/SearchModule'
import { SourceModule } from './modules/SourceModule'
import { AccountModule } from './modules/AccountModule'
import styles from './LeftStrip.module.css'

export function LeftStrip() {
  return (
    <div className={styles.strip}>
      {/* macOS traffic lights 占位 + 拖拽区 */}
      <div className={`${styles.dragArea} desktop-shell`} aria-hidden="true" />

      {/* 主图标区 */}
      <div className={styles.icons}>
        <div className={styles.moduleWrap}>
          <SearchModule />
        </div>
        <div className={styles.moduleWrap}>
          <NavModule />
        </div>
      </div>

      {/* 底部图标区 */}
      <div className={styles.bottomIcons}>
        <div className={styles.moduleWrap}>
          <SourceModule />
        </div>
        <div className={styles.moduleWrap}>
          <AccountModule />
        </div>
      </div>
    </div>
  )
}
