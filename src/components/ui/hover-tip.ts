/** 提示优先向上；顶部空间不足时向下，长内容始终限制在视口内。 */
export function hoverTipPosition(anchor: { cx: number; top: number; bottom: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const edge = 8
  const gap = 8
  const clamp = (value: number, max: number) => Math.max(edge, Math.min(value, max))
  const below = anchor.top - gap - size.height < edge
  return {
    left: clamp(anchor.cx - size.width / 2, viewport.width - edge - size.width),
    top: clamp(below ? anchor.bottom + gap : anchor.top - gap - size.height, viewport.height - edge - size.height),
    below,
  }
}

/** 禁用原因优先于通用动作名称；可用按钮仍优先使用明确的提示文案。 */
export function hoverTipText({ disabled, tip, title, label }: { disabled: boolean; tip?: string; title?: string | null; label?: string | null }) {
  return disabled ? title || tip || label : tip || title || label
}
