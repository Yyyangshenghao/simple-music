/**
 * 曲目时长格式化。**入参单位是毫秒** —— `Track.duration` 全项目约定为毫秒
 * (网易 `dt` 原样、QQ `interval×1000`、本地 `format.duration×1000`)。
 *
 * 单独成模块是为了防复发:曾经把毫秒当秒显示过一次(ca700db),而此前
 * 各列表组件里散着 4 份一模一样的实现 —— 改对一处、漏掉三处是迟早的事。
 *
 * 注意与 PlayerBar 的 `formatTime` 区分:那个吃的是**秒**(播放器 store 的
 * position/duration 是秒),不要互相替换。
 */
export function formatDuration(ms: number | undefined, empty = ''): string {
  if (!ms || ms <= 0) return empty
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
