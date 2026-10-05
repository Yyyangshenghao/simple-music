export function playbackStrategySummary(
  providerLabels: string[],
  preferOriginSource: boolean,
  multiSourceFallback: boolean
): string {
  if (providerLabels.length === 0) return '暂无已启用的在线音源'
  if (providerLabels.length === 1) return `联网时使用 ${providerLabels[0]}`
  if (preferOriginSource) {
    return multiSourceFallback
      ? `联网时歌曲来源已启用则先用它；失败后按 ${providerLabels.join(' → ')} 中尚未尝试的平台接力`
      : `联网时只尝试一个平台：歌曲来源已启用时优先，否则使用 ${providerLabels[0]}`
  }
  return multiSourceFallback
    ? `联网时依次尝试：${providerLabels.join(' → ')}`
    : `联网时只尝试：${providerLabels[0]}`
}
