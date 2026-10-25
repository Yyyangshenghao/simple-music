import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { springSnappy } from '../../lib/motion-presets'
import styles from './TrackSearch.module.css'
import { useMotion } from '../../hooks/useMotion'

const COLLAPSED_WIDTH = 36
const EXPANDED_WIDTH = 280

interface TrackSearchProps {
  value: string
  onChange(value: string): void
  placeholder: string
  count: number
  loading?: boolean
  error?: boolean
  onRetry?(): void
  children?: ReactNode
}

export function TrackSearch({ value, onChange, placeholder, count, loading, error, onRetry, children }: TrackSearchProps) {
  const controlMotion = useMotion('iconMotion')
  const active = Boolean(value.trim())
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 平时收成放大镜；聚焦或有内容时展开，空且失焦时收回。
  const expanded = focused || Boolean(value)

  const status = error ? `部分歌曲未能加载，已找到 ${count} 首`
    : loading ? `正在搜索完整列表… 已找到 ${count} 首`
      : count ? `找到 ${count} 首歌曲` : '没有找到匹配的歌曲'
  return (
    <div className={styles.toolbar}>
      <div className={styles.context}>
        {children ?? <><h2 className={styles.heading}>歌曲列表</h2><span className={styles.total}>{loading && !count ? '加载中…' : `${count} 首`}</span></>}
      </div>
      <div className={styles.search}>
        <motion.div
          className={`${styles.field} ${active ? styles.active : ''} no-drag`}
          data-expanded={expanded}
          initial={false}
          animate={{ width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
          transition={controlMotion ? springSnappy : { duration: 0 }}
          onClick={() => inputRef.current?.focus()}
        >
          <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { onChange(''); event.currentTarget.blur() } }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
          {active && <span className={styles.result} role="status" aria-label={status} title={status}>
            {loading && !error ? <span className={styles.spinner} aria-hidden="true" /> : null}
            {count ? `${count} 首` : loading ? '搜索中' : '无匹配'}
          </span>}
          {value && <button className={styles.clear} type="button" onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); onChange(''); inputRef.current?.focus() }} aria-label="清空搜索">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>}
        </motion.div>
        {active && error && <div className={styles.error} role="status">部分歌曲加载失败 <button type="button" onClick={onRetry}>重试</button></div>}
      </div>
    </div>
  )
}
