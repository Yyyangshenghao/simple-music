import { useEffect, useRef } from 'react'
import { EXPLORE_MODULES } from '../../lib/explore-modules'
import type { ProviderId } from '../../providers/types'
import { useSettingsStore } from '../../stores/settings'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { useListReorder } from '../ui/useListReorder'
import { Switch } from '../ui/Switch'
import { ExplorePagePreview } from './ExplorePagePreview'
import styles from './ExploreModuleSettings.module.css'

export function ExploreModuleSettings({ source }: { source: ProviderId }) {
  const layout = useSettingsStore(state => state.exploreLayouts[source])
  const setLayout = useSettingsStore(state => state.setExploreLayout)
  const listRef = useRef<HTMLOListElement>(null)
  const dragMotion = useMotion('dragMotion')
  const reducedMotion = useSystemReducedMotion()
  const available = EXPLORE_MODULES[source]
  const { drag, rowProps, ghost } = useListReorder({
    listRef, total: layout.length, orderKey: layout.map(module => module.id).join(), reducedMotion: !dragMotion || reducedMotion,
    onMove: (from, to) => {
      const next = [...layout]
      next.splice(to, 0, ...next.splice(from, 1))
      setLayout(source, next)
    },
  })
  // 窄窗口的模块列表可滚动；拖至面板上下边缘时连续滚动，支持首尾换位。
  useEffect(() => {
    if (!drag) return
    const viewport = listRef.current?.closest<HTMLElement>('[data-provider-settings-scroll]')
    if (!viewport) return
    let y: number | undefined
    let frame = 0
    let previous = 0
    const move = (event: PointerEvent) => { y = event.clientY }
    const tick = (now: number) => {
      const bounds = viewport.getBoundingClientRect()
      const edge = 40
      const distance = y === undefined ? 0 : y < bounds.top + edge ? y - bounds.top - edge : y > bounds.bottom - edge ? y - bounds.bottom + edge : 0
      viewport.scrollTop += Math.max(-1, Math.min(1, distance / edge)) * Math.min(32, now - previous || 16) * .4
      previous = now
      frame = requestAnimationFrame(tick)
    }
    const stop = () => { y = undefined; cancelAnimationFrame(frame) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    frame = requestAnimationFrame(tick)
    return () => {
      stop()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [!!drag])
  if (!available.length) return null
  return <section className={styles.section} aria-label="探索页模块设置">
    <div className={styles.editor}>
      <div className={styles.heading}><h3>探索页模块</h3><span>{layout.filter(module => module.enabled).length} / {layout.length} 已开启</span></div>
      <p className={styles.hint}>拖动调整顺序，关闭不想展示的内容。</p>
      <ol ref={listRef} className={styles.list} aria-label="探索页模块顺序">
        {layout.map((module, index) => <li key={module.id} {...rowProps(index)} className={styles.row} data-enabled={module.enabled}>
          <span className={styles.grip} aria-hidden="true"><svg viewBox="0 0 20 20" fill="currentColor"><circle cx="7" cy="5" r="1.2" /><circle cx="13" cy="5" r="1.2" /><circle cx="7" cy="10" r="1.2" /><circle cx="13" cy="10" r="1.2" /><circle cx="7" cy="15" r="1.2" /><circle cx="13" cy="15" r="1.2" /></svg></span>
          <div className={styles.name}><strong>{available.find(item => item.id === module.id)?.label}</strong>
            {module.id === 'recommendations' && <small>{source === 'netease' ? '每日推荐、私人雷达与发现歌单' : source === 'qq' ? '每日30首、猜你喜欢、私人雷达与发现歌单' : '发现歌单'}</small>}
          </div>
          <Switch checked={module.enabled} aria-label={`展示${available.find(item => item.id === module.id)?.label}`}
            onChange={enabled => setLayout(source, layout.map(item => item.id === module.id ? { ...item, enabled } : item))} />
        </li>)}
        {ghost}
      </ol>
      <footer className={styles.footer}><span>更改自动保存</span><button type="button" onClick={() => setLayout(source, [])}>恢复默认</button></footer>
    </div>
    <ExplorePagePreview source={source} />
  </section>
}
