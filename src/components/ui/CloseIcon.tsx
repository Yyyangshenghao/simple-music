interface CloseIconProps {
  size?: number
}

/** 统一的关闭/移除图标：替代项目里各处混用的 ✕/× 文本字符。 */
export function CloseIcon({ size = 16 }: CloseIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
