/**
 * Apple Music 常用地区（storefront 两位小写地区码）。地区由 Apple ID 决定，
 * 这里只用于登录前指定登录页地区；登录后以账号返回的地区为准。
 */
const COMMON_REGIONS: readonly { code: string; label: string }[] = [
  { code: 'cn', label: '中国大陆' },
  { code: 'hk', label: '中国香港' },
  { code: 'tw', label: '中国台湾' },
  { code: 'mo', label: '中国澳门' },
  { code: 'us', label: '美国' },
  { code: 'jp', label: '日本' },
  { code: 'kr', label: '韩国' },
  { code: 'sg', label: '新加坡' },
  { code: 'gb', label: '英国' },
  { code: 'ca', label: '加拿大' },
  { code: 'au', label: '澳大利亚' },
  { code: 'de', label: '德国' },
  { code: 'fr', label: '法国' },
]
export const AUTO_REGION_LABEL = '按网络自动'

let regionNames: Intl.DisplayNames | null | undefined
export function appleRegionLabel(code: string): string {
  if (!code) return AUTO_REGION_LABEL
  const common = COMMON_REGIONS.find((region) => region.code === code)
  if (common) return common.label
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' }) } catch { regionNames = null }
  }
  try { return regionNames?.of(code.toUpperCase()) ?? code.toUpperCase() } catch { return code.toUpperCase() }
}

/** 下拉选项：自动 + 常用地区；当前值不在常用列表（如账号在泰国）时补上，保证能显示。 */
export function appleRegionOptions(current: string): { value: string; label: string }[] {
  const options = [{ value: '', label: AUTO_REGION_LABEL }, ...COMMON_REGIONS.map((region) => ({ value: region.code, label: region.label }))]
  if (/^[a-z]{2}$/.test(current) && !COMMON_REGIONS.some((region) => region.code === current)) options.push({ value: current, label: appleRegionLabel(current) })
  return options
}
