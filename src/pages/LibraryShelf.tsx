import type { ReactNode, RefObject } from 'react'
import { useProgressiveCount } from '../hooks/useProgressiveCount'
import styles from './LibraryShelf.module.css'

/** 我的库里的歌单架：应用歌单与平台歌单共用的外框、头部与操作组，主体由调用方决定。 */
export function LibraryShelf({ label, identity, actions, children }: {
  label: string
  identity: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={styles.shelf} aria-label={label}>
      <header className={styles.header}>
        {identity}
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </section>
  )
}

/** 网格分批渲染：只挂载可见附近的卡片，滚到底部再追加。 */
export function ShelfGrid<T>({ items, scrollRef, render }: {
  items: T[]
  scrollRef: RefObject<HTMLDivElement>
  render(item: T): ReactNode
}) {
  const progressive = useProgressiveCount(items.length, scrollRef)
  return <>
    <div className={styles.grid}>{items.slice(0, progressive.visible).map(render)}</div>
    {progressive.hasMore && <div ref={progressive.sentinelRef} className={styles.sentinel} aria-hidden="true" />}
  </>
}

export function ShelfSkeleton() {
  return <div className={styles.grid} aria-label="正在加载歌单" role="status">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.skeleton} />)}
  </div>
}

/** 空态与错误态：一句说明，可选一个恢复操作。 */
export function ShelfMessage({ children, action, alert = false }: { children: ReactNode; action?: { label: string; onClick(): void }; alert?: boolean }) {
  return <div className={styles.message} role={alert ? 'alert' : undefined}>
    <p>{children}</p>
    {action && <button type="button" className={`${styles.pillButton} no-drag`} onClick={action.onClick}>{action.label}</button>}
  </div>
}

/** 应用歌单的身份标识，与平台来源徽标同形。 */
export function AppPlaylistsTag() {
  return <span className={styles.tag}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" /><path d="M18 15l.8 1.9 1.9.8-1.9.8L18 20.4l-.8-1.9-1.9-.8 1.9-.8z" /></svg>
    应用歌单
  </span>
}

export function ShelfCreateButton({ onClick, disabled }: { onClick(): void; disabled?: boolean }) {
  return <button type="button" className={`${styles.pillButton} no-drag`} disabled={disabled} onClick={onClick}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    新建歌单
  </button>
}

export function ShelfRefreshButton({ onClick, refreshing }: { onClick(): void; refreshing: boolean }) {
  return <button type="button" className={`${styles.iconButton} no-drag`} onClick={onClick} disabled={refreshing}
    aria-label={refreshing ? '正在刷新' : '刷新'} title={refreshing ? '正在刷新' : '刷新'} data-refreshing={refreshing}>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
  </button>
}
