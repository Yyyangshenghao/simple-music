import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMotion, usePageTransition } from '../../hooks/useMotion'
import { tooltipPop } from '../../lib/motion-presets'
import { collectSettingsEntries, groupSettingsResults, searchSettings, settingsMatchExcerpt, settingsMatchParts, settingsSearchTerms, type SettingSearchEntry } from '../../lib/settings-search'
import styles from './SettingsSearch.module.css'

const entryKey = (entry: SettingSearchEntry) => `${entry.section}|${entry.detail ?? ''}|${entry.label}`

/** 落点高亮停留时长，与 SettingsPage.module.css 的 settingsSearchHit 动画一致。 */
const HIT_DURATION = 2400

export function SettingsSearch({ pageRef, onNavigate }: {
  pageRef: RefObject<HTMLElement>
  onNavigate(section: string, detail?: string): void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SettingSearchEntry[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const landed = useRef<HTMLElement | null>(null)
  const hitTimer = useRef(0)
  // 同一关键词下看过的结果：回到搜索时停在最后一次前往的那项，看过的都打标记。
  const visits = useRef<{ query: string; keys: string[] }>({ query: '', keys: [] })
  const resultId = useId()
  const smoothScroll = useMotion('smoothScrollMotion')
  const fade = useMotion('pageTransitionMotion')
  const transition = usePageTransition()

  const groups = groupSettingsResults(results)
  // 键盘上下移动按分组后的显示顺序。
  const ordered = groups.flatMap(group => group.items)

  function clearHighlight() {
    window.clearTimeout(hitTimer.current)
    landed.current?.removeAttribute('data-settings-search-hit')
    landed.current = null
  }
  function search(value: string) {
    clearHighlight()
    setQuery(value)
    const found = pageRef.current ? searchSettings(collectSettingsEntries(pageRef.current), value) : []
    setResults(found)
    if (value.trim() !== visits.current.query) visits.current = { query: value.trim(), keys: [] }
    const last = visits.current.keys.at(-1)
    const index = last ? groupSettingsResults(found).flatMap(group => group.items).findIndex(entry => entryKey(entry) === last) : -1
    setActive(Math.max(0, index))
    setOpen(!!value.trim())
  }
  function locate(entry: SettingSearchEntry) {
    if (!pageRef.current || !entry.target.isConnected) { search(query); return }
    clearHighlight()
    setOpen(false)
    const key = entryKey(entry)
    visits.current = { query: query.trim(), keys: [...visits.current.keys.filter(item => item !== key), key] }
    onNavigate(entry.section, entry.detail)
    landed.current = entry.target
    entry.target.setAttribute('data-settings-search-hit', fade ? 'fade' : '')
    hitTimer.current = window.setTimeout(clearHighlight, HIT_DURATION)
    const page = pageRef.current
    // 窄窗口导航横排并固定在顶部，避开整个导航区域。
    const drawer = wrapper.current?.parentElement
    const topInset = (parseFloat(getComputedStyle(page).getPropertyValue('--sm-topbar-height')) || 0) + 24
    // 分类切换会在下一帧展开一行 32px 的子导航，先预留这段高度。
    const offset = window.innerWidth <= 1000 && drawer ? topInset + drawer.offsetHeight + 32 : topInset
    const top = entry.target.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - offset
    page.scrollTo({ top, behavior: smoothScroll ? 'smooth' : 'instant' })
    input.current?.blur()
  }
  function move(step: number) {
    if (!ordered.length) return
    setOpen(true)
    setActive(index => (index + step + ordered.length) % ordered.length)
  }

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      clearHighlight()
    }
  }, [])

  useEffect(() => {
    if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const highlight = (text: string) => settingsMatchParts(text, query).map((part, i) => part.match ? <mark key={i}>{part.text}</mark> : part.text)
  const visited = query.trim() === visits.current.query ? visits.current.keys : []
  const optionId = (index: number) => `${resultId}-option-${index}`
  return <div className={styles.search} ref={wrapper}
    onBlur={event => { if (!wrapper.current?.contains(event.relatedTarget)) setOpen(false) }}>
    <div className={styles.field}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input ref={input} type="search" role="combobox" aria-label="搜索设置" placeholder="搜索设置" value={query}
        autoComplete="off" spellCheck={false} aria-autocomplete="list"
        aria-controls={open ? resultId : undefined} aria-expanded={open}
        aria-activedescendant={open && ordered[active] ? optionId(active) : undefined}
        onChange={event => search(event.target.value)}
        onFocus={() => { if (query.trim()) search(query) }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown') { event.preventDefault(); move(open ? 1 : 0) }
          if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
          if (event.key === 'Escape') {
            event.stopPropagation()
            // 先收起结果，再清空，最后离开搜索框。
            if (open) setOpen(false)
            else if (query) search('')
            else input.current?.blur()
          }
          if (event.key === 'Enter' && ordered[active]) { event.preventDefault(); locate(ordered[active]) }
        }} />
      {query &&
        // 按下时不抢焦点；先聚焦再清空，否则 onFocus 会用旧关键词把结果搜回来。
        <button type="button" className={styles.clear} aria-label="清空设置搜索"
          onPointerDown={event => event.preventDefault()}
          onClick={() => { input.current?.focus(); search('') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>}
    </div>
    <AnimatePresence>
      {open && <motion.div key="results" ref={list} id={resultId} role="listbox" aria-label="设置搜索结果" className={styles.results}
        initial={{ opacity: 0, y: -tooltipPop.rise, scale: tooltipPop.scale }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -tooltipPop.rise, scale: tooltipPop.scale }}
        transition={transition({ duration: tooltipPop.duration, ease: tooltipPop.ease })}
        // 点选结果时焦点留在输入框，避免先失焦把列表收起。
        onPointerDown={event => event.preventDefault()}>
        {ordered.length
          ? <p className={styles.count} role="status">{`找到 ${ordered.length} 项设置`}</p>
          : <p className={styles.empty} role="status">没有找到「{query.trim()}」相关设置<span>换个更短的词，或用空格分开多个关键词</span></p>}
        {groups.map(group => <div key={group.section} role="group" aria-label={group.label} className={styles.group}>
          <p className={styles.groupLabel} aria-hidden="true">{group.label}</p>
          {group.items.map(entry => {
            const index = ordered.indexOf(entry)
            const excerpt = settingsSearchTerms(query).every(term => entry.label.toLocaleLowerCase().includes(term)) ? '' : settingsMatchExcerpt(entry.description, query)
            return <div key={index} id={optionId(index)} role="option" aria-selected={index === active}
              className={styles.result} onPointerMove={() => setActive(index)} onClick={() => locate(entry)}>
              <span className={styles.label}>
                {highlight(entry.label)}
                {visited.includes(entryKey(entry)) && <span className={styles.visited}>{entryKey(entry) === visited.at(-1) ? '刚刚查看' : '已查看'}</span>}
              </span>
              {entry.detailLabel && entry.detailLabel !== entry.label && <span className={styles.path}>{highlight(entry.detailLabel)}</span>}
              {excerpt && <span className={styles.description}>{highlight(excerpt)}</span>}
            </div>
          })}
        </div>)}
      </motion.div>}
    </AnimatePresence>
  </div>
}
