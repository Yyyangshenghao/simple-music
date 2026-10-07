/// <reference types="vite/client" />

export type ReleaseChangeType = 'feat' | 'perf' | 'fix' | 'note'

export interface ReleaseChange {
  type: ReleaseChangeType
  title?: string
  description: string
}

export interface ReleaseHistoryEntry {
  version: string
  updates: ReleaseChange[]
  compatibility: string[]
}

const releaseNotes = import.meta.glob<string>('../../docs/release-notes-*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function plainText(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim()
}

function parseChange(text: string): ReleaseChange {
  const labels: Record<string, ReleaseChangeType> = {
    新增: 'feat', feat: 'feat', 优化: 'perf', perf: 'perf',
    修复: 'fix', fix: 'fix', 说明: 'note', note: 'note',
  }
  const labelled = text.match(/^(新增|优化|修复|说明|feat|perf|fix|note)\s*[·：:]\s*(.+)$/i)
  if (labelled) {
    const content = labelled[2]
    const titled = content.match(/^([^：:]+)[：:]\s*(.+)$/)
    return {
      type: labels[labelled[1].toLowerCase()],
      ...(titled ? { title: titled[1].trim() } : {}),
      description: titled ? titled[2] : content,
    }
  }
  const type = /^(新增|支持|补齐)/.test(text) ? 'feat'
    : /^修复/.test(text) ? 'fix'
    : /^(优化|完善)/.test(text) ? 'perf' : 'note'
  return { type, description: text }
}

export function buildReleaseHistory(notes: Record<string, string>, currentVersion: string): ReleaseHistoryEntry[] {
  const entries: ReleaseHistoryEntry[] = []
  for (const [path, markdown] of Object.entries(notes)) {
    const version = path.match(/release-notes-(\d+\.\d+\.\d+)\.md$/)?.[1]
    if (!version || compareVersions(version, currentVersion) > 0) continue

    const updates: string[] = []
    const compatibility: string[] = []
    let section: string[] | null = null
    for (const line of markdown.split(/\r?\n/)) {
      const heading = line.match(/^##\s+(.+?)\s*$/)?.[1]
      if (heading) {
        section = heading === '更新日志' || heading === '主要变化'
          ? updates
          : heading === '兼容说明' ? compatibility : null
        continue
      }
      if (!section) continue
      const bullet = line.match(/^\s*[-*]\s+(.+)$/)?.[1]
      if (bullet) section.push(plainText(bullet))
      else if (/^\s+\S/.test(line) && section.length > 0) {
        section[section.length - 1] += ` ${plainText(line)}`
      }
    }
    if (updates.length > 0) entries.push({ version, updates: updates.map(parseChange), compatibility })
  }
  return entries.sort((a, b) => compareVersions(b.version, a.version))
}

export function getReleaseHistory(currentVersion: string): ReleaseHistoryEntry[] {
  return buildReleaseHistory(releaseNotes, currentVersion)
}
