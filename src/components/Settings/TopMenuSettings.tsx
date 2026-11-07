import { useRef } from 'react'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { DEFAULT_TOP_MENU, TOP_MENU_ITEMS } from '../../lib/top-menu'
import { useSettingsStore } from '../../stores/settings'
import { ActionButton } from '../ui/ActionButton'
import { Switch } from '../ui/Switch'
import { useListReorder } from '../ui/useListReorder'
import styles from './TopMenuSettings.module.css'

export function TopMenuSettings({ headingClassName }: { headingClassName: string }) {
  const items = useSettingsStore(state => state.topMenu)
  const setEnabled = useSettingsStore(state => state.setTopMenuItemEnabled)
  const move = useSettingsStore(state => state.moveTopMenuItem)
  const reset = useSettingsStore(state => state.resetTopMenu)
  const listRef = useRef<HTMLOListElement>(null)
  const dragMotion = useMotion('dragMotion')
  const reducedMotion = useSystemReducedMotion()
  const { drag, rowProps, ghost } = useListReorder({
    listRef,
    total: items.length,
    orderKey: items.map(item => item.id).join(),
    reducedMotion: !dragMotion || reducedMotion,
    onMove: (from, to) => move(items[from].id, to),
  })
  const isDefault = items.every((item, index) => item.enabled && item.id === DEFAULT_TOP_MENU[index].id)
  const settingsVisible = items.some(item => item.id === 'settings' && item.enabled)

  return <>
    <header className={headingClassName}>
      <h3 className={styles.title}>顶部菜单</h3>
      <ActionButton label="恢复默认" aria-label="恢复顶部菜单默认设置" compact disabled={isDefault || drag !== null} onClick={() => reset()} />
    </header>
    <div className={styles.editor}>
      <ol ref={listRef} className={styles.list} aria-label="顶部菜单顺序">
        {items.map(({ id, enabled }, index) => <li key={id} {...rowProps(index)} className={styles.row} data-enabled={enabled}>
          <svg className={styles.grip} width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <circle cx="7" cy="5" r="1.2" /><circle cx="13" cy="5" r="1.2" />
            <circle cx="7" cy="10" r="1.2" /><circle cx="13" cy="10" r="1.2" />
            <circle cx="7" cy="15" r="1.2" /><circle cx="13" cy="15" r="1.2" />
          </svg>
          <span className={styles.label}>{TOP_MENU_ITEMS[id]}</span>
          <Switch checked={enabled} aria-label={`显示${TOP_MENU_ITEMS[id]}`} onChange={value => setEnabled(id, value)} />
        </li>)}
        {ghost}
      </ol>
      <p className={styles.hint}>{settingsVisible ? '拖动排序，开关控制显示' : '可从右上角头像进入设置'}</p>
    </div>
  </>
}
