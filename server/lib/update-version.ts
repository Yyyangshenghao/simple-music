// 更新链路共用的版本号比较；主进程安装器与 server 更新检查/清理都按同一规则判断新旧。
export function normalizeVersion(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/[+].*$/, '')
    .replace(/-.+$/, '')
}
export function compareVersions(a: unknown, b: unknown): number {
  const aa = normalizeVersion(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const bb = normalizeVersion(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const len = Math.max(aa.length, bb.length, 3)
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0
    const right = bb[i] || 0
    if (left > right) return 1
    if (left < right) return -1
  }
  return 0
}
