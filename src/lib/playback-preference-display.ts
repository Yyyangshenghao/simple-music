export function playbackStrategySummary(
  providerLabels: string[],
  preferOriginSource: boolean,
  multiSourceFallback: boolean
): string {
  if (providerLabels.length === 0) return '暂无已启用的在线音源'
  if (providerLabels.length === 1) return `所有在线歌曲使用 ${providerLabels[0]}`
  if (preferOriginSource) {
    return multiSourceFallback
      ? `歌曲来源已启用时先用它；失败后按 ${providerLabels.join(' → ')} 中尚未尝试的平台接力`
      : `只尝试一个平台：歌曲来源已启用时优先，否则使用 ${providerLabels[0]}`
  }
  return multiSourceFallback
    ? `所有歌曲依次尝试：${providerLabels.join(' → ')}`
    : `所有歌曲只尝试：${providerLabels[0]}`
}
