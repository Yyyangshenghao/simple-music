import type { AmllHostPreference } from '../stores/settings'

/** 设置页展示用的线路名称；id 与 server/lib/amll-lyrics.ts 的 AMLL_HOSTS 一致。 */
export const AMLL_HOST_LABELS: Record<AmllHostPreference, string> = {
  auto: '自动',
  github: 'GitHub',
  gbclstudio: '镜像 gbclstudio',
  bikonoo: '镜像 bikonoo'
}

export interface AmllHostLatency {
  id: string
  ms: number | null
}

/** 测速结果里最快的可用线路；全部不可用时返回 null。 */
export function fastestAmllHost(hosts: readonly AmllHostLatency[]): string | null {
  let best: AmllHostLatency | null = null
  for (const host of hosts) {
    if (host.ms === null) continue
    if (!best || host.ms < best.ms!) best = host
  }
  return best?.id ?? null
}

export function formatAmllLatency(ms: number | null | undefined): string {
  if (ms === undefined) return ''
  if (ms === null) return '不可用'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}
