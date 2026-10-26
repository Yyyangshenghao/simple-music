export interface SearchableSetting {
  label: string
  description: string
  section: string
  sectionLabel: string
  detail?: string
  detailLabel: string
  controlLabels?: string
}

export interface SettingSearchEntry extends SearchableSetting { target: HTMLElement }

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
export const settingsSearchTerms = (query: string) => [...new Set(normalize(query).split(' ').filter(Boolean))]

/** 关键词的字按顺序出现在名称里，如「桌面字号」对上「桌面歌词字号」。 */
function inOrder(text: string, chars: string): boolean {
  let at = 0
  for (const char of chars) {
    at = text.indexOf(char, at)
    if (at < 0) return false
    at += char.length
  }
  return true
}

export function searchSettings<T extends SearchableSetting>(entries: T[], query: string): T[] {
  const terms = settingsSearchTerms(query)
  if (!terms.length) return []
  // 单个关键词没有完整命中时，名称里按序出现全部字符也算，排在最后。
  const loose = terms.length === 1 && [...terms[0]].length >= 2 ? terms[0].replace(/\s/g, '') : ''
  return entries.map(entry => {
    const label = normalize(entry.label)
    const text = normalize(`${entry.label} ${entry.description} ${entry.sectionLabel} ${entry.detailLabel} ${entry.controlLabels ?? ''}`)
    const exact = terms.every(term => text.includes(term))
    const path = normalize(`${entry.sectionLabel} ${entry.detailLabel}`)
    // 同档里分类名也命中关键词的排前，如搜「歌词」时「歌词与特效」组优先。
    const score = (label === normalize(query) ? 3 : terms.every(term => label.includes(term)) ? 2 : exact ? 1 : 0)
      + (terms.some(term => path.includes(term)) ? 0.5 : 0)
    return { entry, score, matches: exact || (!!loose && inOrder(label, loose)) }
  }).filter(item => item.matches).sort((a, b) => b.score - a.score).map(item => item.entry)
}

/** 按分类聚合结果：分类顺序跟随其中最相关的一项，组内保持相关度顺序。 */
export function groupSettingsResults<T extends SearchableSetting>(results: T[]): { section: string; label: string; items: T[] }[] {
  const groups = new Map<string, { section: string; label: string; items: T[] }>()
  for (const entry of results) {
    const group = groups.get(entry.section) ?? { section: entry.section, label: entry.sectionLabel, items: [] }
    group.items.push(entry)
    groups.set(entry.section, group)
  }
  return [...groups.values()]
}

/** 说明节点常驻于 InfoButton 内，但不计入设置名称。 */
function labelText(node: Element | null): string {
  if (!node) return ''
  const copy = node.cloneNode(true) as Element
  copy.querySelectorAll('[data-settings-info], button, input, select, svg, [aria-hidden="true"]').forEach(child => child.remove())
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

/** 从当前实际渲染的设置建立索引，平台专属和条件设置不出现失效入口。 */
export function collectSettingsEntries(root: HTMLElement): SettingSearchEntry[] {
  const entries: SettingSearchEntry[] = []
  for (const section of root.querySelectorAll<HTMLElement>('[id^="settings-section-"]')) {
    const sectionLabel = labelText(section.querySelector('h2'))
    for (const target of section.querySelectorAll<HTMLElement>('[data-setting-row], h3, th[scope="row"]')) {
      if (target.closest('[hidden], [inert], [aria-hidden="true"]') || !target.getClientRects().length) continue
      const detail = target.closest<HTMLElement>('[id^="settings-detail-"]')
      const label = target.dataset.settingLabel || labelText(target.querySelector('[data-setting-label]') ?? (target.matches('h3, th') ? target : target.firstElementChild))
      if (!label) continue
      const row = target.matches('th') ? target.parentElement! : target
      const copy = row.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[data-settings-info], svg, [aria-hidden="true"]').forEach(child => child.remove())
      const tips = [...row.querySelectorAll('[role="tooltip"]')].map(node => node.textContent).join(' ')
      entries.push({
        label,
        description: target.matches('h3')
          ? tips
          : `${copy.textContent ?? ''} ${tips}`.replace(/\s+/g, ' ').trim(),
        controlLabels: [...row.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).join(' '),
        section: section.id.slice('settings-section-'.length),
        sectionLabel,
        detail: detail?.id.slice('settings-detail-'.length),
        detailLabel: labelText(detail?.querySelector('h3') ?? null),
        target: row,
      })
    }
  }
  return entries
}

export function settingsMatchParts(text: string, query: string): { text: string; match: boolean }[] {
  const terms = settingsSearchTerms(query)
  if (!terms.length) return [{ text, match: false }]
  const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|')
  return text.split(new RegExp(`(${pattern})`, 'gi')).filter(Boolean).map(part => ({ text: part, match: terms.includes(normalize(part)) }))
}

export function settingsMatchExcerpt(text: string, query: string): string {
  const positions = settingsSearchTerms(query).map(term => normalize(text).indexOf(term)).filter(index => index >= 0)
  if (!positions.length) return ''
  const start = Math.max(0, Math.min(...positions) - 18)
  const end = Math.min(text.length, start + 88)
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
