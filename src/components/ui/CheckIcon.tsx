interface CheckIconProps {
  size?: number
}

/** 统一的选中对勾图标：配合选中态徽标使用。 */
export function CheckIcon({ size = 12 }: CheckIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5L6.5 12L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
