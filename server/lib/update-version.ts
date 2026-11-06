// 更新链路共用的版本号比较；主进程安装器与 server 更新检查/清理都按同一规则判断新旧。
export function normalizeVersion(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/[+].*$/, '')
    .replace(/-.+$/, '')
}

function prereleaseOf(value: unknown): string[] {
  const match = String(value || '').trim().replace(/[+].*$/, '').match(/-(.+)$/)
  return match ? match[1].split('.') : []
}

/** 发布身份必须保留 beta/rc 后缀；normalizeVersion 只供旧补丁的主版本匹配。 */
export function normalizeReleaseVersion(value: unknown): string {
  const version = String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '')
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version) ? version : ''
}

export function isPrereleaseVersion(value: unknown): boolean {
  return normalizeReleaseVersion(value).includes('-')
}

export function canUpdateTo(current: unknown, candidate: unknown): boolean {
  const from = normalizeReleaseVersion(current)
  const to = normalizeReleaseVersion(candidate)
  return !!from && !!to && (isPrereleaseVersion(from) || !isPrereleaseVersion(to)) && compareVersions(to, from) > 0
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
  // 预发版（2.6.2-beta.1）低于同号正式版，装了预发版的机器才能收到正式版更新。
  const pa = prereleaseOf(a)
  const pb = prereleaseOf(b)
  if (!pa.length || !pb.length) return pa.length === pb.length ? 0 : pa.length ? -1 : 1
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN
    if (na === nb || pa[i] === pb[i]) continue
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na > nb ? 1 : -1
    if (!Number.isNaN(na)) return -1
    if (!Number.isNaN(nb)) return 1
    return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}
