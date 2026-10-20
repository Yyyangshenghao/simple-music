import styles from './BackButton.module.css'

interface BackButtonProps {
  onClick: () => void
  /** 悬停/聚焦时展开的文字 */
  label?: string
  ariaLabel?: string
  /** 页面自身的定位样式(外边距等) */
  className?: string
}

/** 各页面统一的返回按钮：沿用歌词页收起按钮的玻璃圆钮，悬停时向右展开文字。 */
export function BackButton({ onClick, label = '返回', ariaLabel, className }: BackButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.backBtn} no-drag${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      title={label}
    >
      <span className={styles.icon}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </span>
      <span className={styles.label} aria-hidden="true"><span>{label}</span></span>
    </button>
  )
}
