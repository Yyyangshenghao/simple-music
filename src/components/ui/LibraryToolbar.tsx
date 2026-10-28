import { useRef, type ReactNode } from 'react'
import { HoverTips } from './HoverTips'
import { CloseIcon } from './CloseIcon'
import styles from './LibraryToolbar.module.css'

/** 伴奏、本地与离线音乐统一的列表工具栏；业务操作由页面提供。 */
export function LibraryToolbar({ summary, primary, value, onChange, searchLabel, placeholder = '搜索歌曲或艺人', disabled, children }: {
  summary: ReactNode
  primary: ReactNode
  value: string
  onChange(value: string): void
  searchLabel: string
  placeholder?: string
  disabled?: boolean
  children?: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const clear = () => { onChange(''); input.current?.focus() }
  return <div className={styles.toolbar} data-library-toolbar>
    <div className={styles.context}>{primary}<span className={styles.summary}>{summary}</span></div>
    <div className={styles.controls}>
      <div className={styles.search} data-filtered={!!value.trim() || undefined} onClick={() => { if (!disabled) input.current?.focus() }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input ref={input} type="search" aria-label={searchLabel} placeholder={placeholder} value={value} disabled={disabled}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); clear() } }} />
        {value && <button type="button" className={styles.clear} aria-label={`清空${searchLabel}`} title="清空搜索" disabled={disabled}
          onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); clear() }}><CloseIcon size={12} /></button>}
      </div>
      <div className={styles.actions}>{children}<HoverTips match="[data-icon-action]" /></div>
    </div>
  </div>
}
