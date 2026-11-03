import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useTaskCenterStore } from '../../stores/task-center'
import { useKaraokeStore } from '../../stores/karaoke'
import { useKaraokeModelsStore } from '../../stores/karaoke-models'
import { DEFAULT_KARAOKE_BACKING, DEFAULT_KARAOKE_LEAD, useSettingsStore } from '../../stores/settings'
import { openAccompanimentsLibrary, useNavigationStore } from '../../stores/navigation'
import { useToastStore } from '../../stores/toast'
import { useMotion } from '../../hooks/useMotion'
import { liquidDragLead, liquidPillSpring } from '../../lib/motion-presets'
import { accompanimentId, accompanimentOriginal, accompanimentsForTrack } from '../../lib/karaoke-library'
import { HoverTips } from '../ui/HoverTips'
import { ActionButton } from '../ui/ActionButton'
import { LibraryLink } from '../ui/LibraryLink'
import { SettingSlider } from '../ui/SettingSlider'
import { sameKaraokeTrack, type KaraokeModelId } from '../../types/karaoke'
import type { Track } from '../../types/domain'
import styles from './AccompanimentPanel.module.css'

const MODEL_NAMES: Record<KaraokeModelId, string> = { hq3: 'MDX-Net HQ3', 'hq3-fp16': 'MDX-Net HQ3 FP16', kara2: 'MDX-Net Karaoke 2' }
/** 面板里空间有限，标签与分段控件只写模型型号，完整名称在悬停提示里。 */
const MODEL_SHORT: Record<KaraokeModelId, string> = { hq3: 'HQ3', 'hq3-fp16': 'HQ3 FP16', kara2: 'Karaoke 2' }
export function AccompanimentPanel({ track, onClose }: { track: Track; onClose(): void }) {
  const { items, jobs, loaded, error, load, enqueue } = useKaraokeStore()
  const { models, f16, loaded: modelsLoaded, error: modelError, load: loadModels } = useKaraokeModelsStore()
  const accompaniment = usePlayerStore(s => s.accompaniment)
  const select = usePlayerStore(s => s.selectAccompaniment)
  const selected = useSettingsStore(s => s.karaokeModel)
  const setModel = useSettingsStore(s => s.setKaraokeModel)
  const lead = useSettingsStore(s => s.karaokeLead)
  const backing = useSettingsStore(s => s.karaokeBacking)
  const setVocalMix = useSettingsStore(s => s.setKaraokeVocalMix)
  const [adding, setAdding] = useState(false)
  const pending = useRef(false)
  useEffect(() => { void load().catch(() => {}); void loadModels() }, [load, loadModels])
  const original = accompanimentOriginal(track) ?? track
  const entries = accompanimentsForTrack(track, items)
  const activeId = accompanimentId(accompaniment ?? track)
  const expectedKey = `${track.source}:${String(track.id)}`
  const hasPlayable = entries.some(item => item.available)
  const modelName = (id: KaraokeModelId) => models.find(model => model.id === id)?.name ?? MODEL_NAMES[id]
  const notify = (error: unknown) => useToastStore.getState().show(error instanceof Error ? error.message : '操作失败，请重试')

  // 选择后保持面板打开，便于接着调节保留比例或对比其他版本。
  async function choose(id: string | null) {
    try { await select(id, expectedKey) } catch (error) { notify(error) }
  }
  async function generate(model: KaraokeModelId) {
    pending.current = true
    setAdding(true)
    try {
      await enqueue(original, model)
    } catch (error) { notify(error) }
    finally { pending.current = false; setAdding(false) }
  }
  const jobFor = (model: KaraokeModelId) => jobs.find(job => job.model === model && sameKaraokeTrack(job.track, original))
  const savedFor = (model: KaraokeModelId) => entries.find(item => item.model === model && item.available)
  const openQueue = (jobId = jobFor(selected)?.id) => { onClose(); useTaskCenterStore.getState().show('karaoke', jobId ? `k:${jobId}` : undefined) }
  const openLibrary = () => { onClose(); openAccompanimentsLibrary() }
  const openSettings = () => { onClose(); const nav = useNavigationStore.getState(); nav.requestSettingsKaraoke(); nav.navigateTo('settings') }
  // 点一个模型就是对它执行下一步：生成中看任务，已生成就播放，否则直接生成；点过的模型记为默认。
  async function pick(model: KaraokeModelId) {
    if (pending.current) return
    if (model !== selected) setModel(model)
    const job = jobFor(model)
    const saved = savedFor(model)
    if (job) openQueue(job.id)
    else if (saved) await choose(saved.id)
    else await generate(model)
  }
  const choices: ModelChoice[] = models.map(model => {
    const job = jobFor(model.id)
    const saved = savedFor(model.id)
    const unsupported = model.requiresF16 && f16 === false
    const state = job ? job.phase === 'failed' ? 'failed' : 'running' : saved ? 'saved' : 'idle'
    const hint = unsupported ? '当前显卡不支持此模型'
      : job ? job.phase === 'failed' ? '生成失败，点击到任务队列查看' : '正在生成，点击查看任务'
      : saved ? activeId === saved.id ? '' : '已生成，点击播放'
      : error ? '伴奏库读取失败，暂不能生成'
      : model.state !== 'ready' ? `首次需下载约 ${Math.round(model.bytes / 1024 / 1024)} MB 模型` : ''
    return { value: model.id, label: MODEL_SHORT[model.id], title: model.name, description: model.description, state, hint,
      disabled: unsupported || !modelsLoaded || (!job && !saved && (!loaded || !!error)) }
  })
  const playing = entries.find(item => item.id === activeId)
  const mixReason = !playing ? '播放伴奏时可调' : !playing.vocals ? '此版本较早，重新生成后可调' : ''
  const percent = (value: number) => `${Math.round(value * 100)}%`
  return <div className={styles.panel} role="dialog" aria-label="选择伴奏版本">
    <HoverTips match="[data-icon-action]" />
    <div className={styles.head}>
      <div className={styles.heading}><span className={styles.eyebrow}>伴奏</span><strong className={styles.song} title={original.name}>{original.name}</strong></div>
      <ActionButton label="关闭伴奏版本" icon="close" iconOnly compact onClick={onClose} />
    </div>
    <div className={styles.body}>
      <div className={styles.versions} role="group" aria-labelledby="accompaniment-versions">
        <span className={styles.label} id="accompaniment-versions">播放版本</span>
        <button type="button" className={styles.version} data-current={!activeId} aria-pressed={!activeId} onClick={() => void choose(null)}>
          <span className={styles.versionInfo}><strong>原曲</strong></span><Check visible={!activeId} />
        </button>
        {entries.map(item => <button type="button" key={item.id} className={styles.version} data-current={activeId === item.id} aria-pressed={activeId === item.id}
          disabled={!item.available} aria-label={`使用伴奏：${modelName(item.model)}`} title={modelName(item.model)}
          onClick={() => void choose(item.id)}>
          {/* 每个模型只保留一个版本，模型即可区分各版本，不再显示生成时间。 */}
          <span className={styles.versionInfo}><span className={styles.versionTitle}><strong>伴奏</strong><span className={styles.modelTag}>{MODEL_SHORT[item.model]}</span></span>
            {!item.available && <small>文件已丢失，可重新生成</small>}</span>
          <Check visible={activeId === item.id} />
        </button>)}
        {!loaded && <p className={styles.hint} role="status">正在读取伴奏…</p>}
        {error && <p className={styles.hint} role="alert">{error} <button type="button" className={styles.link} onClick={() => void load().catch(() => {})}>重试</button></p>}
      </div>
      {/* 有可播放伴奏时一直保留这一节，在原曲与伴奏间切换不改变面板高度；不可调时只禁用并在标题行说明原因。 */}
      {hasPlayable && <div className={styles.section}>
        <span className={styles.labelRow}><span className={styles.label}>保留人声</span>{mixReason && <small className={styles.labelNote}>{mixReason}</small>}</span>
        <div className={styles.mixRow}><span className={styles.mixName} title="左右声像上的叠轨、和声与 ad-lib">和声</span>
          <SettingSlider value={backing} min={0} max={1} step={0.01} defaultValue={DEFAULT_KARAOKE_BACKING} scale={100} unit="%"
            ariaLabel="和声保留" format={percent} disabled={!!mixReason} onChange={value => setVocalMix(lead, value)} /></div>
        <div className={styles.mixRow}><span className={styles.mixName} title="居中的主唱">导唱</span>
          <SettingSlider value={lead} min={0} max={1} step={0.01} defaultValue={DEFAULT_KARAOKE_LEAD} scale={100} unit="%"
            ariaLabel="导唱保留" format={percent} disabled={!!mixReason} onChange={value => setVocalMix(value, backing)} /></div>
      </div>}
      <div className={styles.section}>
        {choices.length > 0 && <ModelChooser items={choices} value={selected} busy={adding} onSelect={setModel} onPick={id => void pick(id)} />}
        {modelError && <p className={styles.hint} role="alert">{modelError} <button type="button" className={styles.link} onClick={() => void loadModels()}>重试</button></p>}
      </div>
    </div>
    <div className={styles.foot}>
      <LibraryLink label="伴奏库" onClick={openLibrary} />
      <ActionButton label="任务队列" title="任务队列 · 生成进度与重试" icon="queue" iconOnly compact onClick={() => openQueue()} />
      <ActionButton label="伴奏设置" title="伴奏设置 · 模型与保存位置" icon="settings" iconOnly compact onClick={openSettings} />
    </div>
  </div>
}

/** 待确认的生成多久没再按就自动取消（毫秒） */
const ARM_TIMEOUT = 4000

interface ModelChoice {
  value: KaraokeModelId
  label: string
  title: string
  description: string
  state: 'idle' | 'running' | 'failed' | 'saved'
  /** 需要提醒时才有：下载大小、不可用原因、点击会播放或查看任务 */
  hint: string
  disabled: boolean
}

/**
 * 模型选择即生成：点一下选中，指示条滑过去，标题位换成该模型的特点，下一行只在需要时提醒（下载大小、不可用原因等）。
 * 生成要按两下：选中未生成的模型时进入待确认，再按同一个才开始，几秒不按就取消；播放与查看任务按一下即可。
 * 指示条是一块流体玻璃，左右两条边分别用弹簧追随，前沿快、后沿慢，滑动途中先拉长再收拢。
 */
function ModelChooser({ items, value, busy, onSelect, onPick }: { items: ModelChoice[]; value: KaraokeModelId; busy: boolean; onSelect(value: KaraokeModelId): void; onPick(value: KaraokeModelId): void }) {
  const [armed, setArmed] = useState<KaraokeModelId | null>(null)
  const fluid = useMotion('indicatorMotion')
  const host = useRef<HTMLDivElement>(null)
  const placed = useRef(false)
  const left = useMotionValue(0)
  const right = useMotionValue(0)
  const target = value
  const shown = items.find(item => item.value === target) ?? items[0]
  const confirming = armed !== null && armed === shown.value

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(null), ARM_TIMEOUT)
    return () => clearTimeout(timer)
  }, [armed])
  function press(item: ModelChoice) {
    if (item.disabled || busy) return
    if (item.state === 'idle' && armed !== item.value) { if (item.value !== value) onSelect(item.value); setArmed(item.value); return }
    setArmed(null)
    onPick(item.value)
  }

  useLayoutEffect(() => {
    const el = host.current?.querySelector<HTMLElement>(`[data-model="${target}"]`)
    if (!host.current || !el) return
    const l = el.offsetLeft
    const r = host.current.clientWidth - el.offsetLeft - el.offsetWidth
    if (!fluid || !placed.current) { left.jump(l); right.jump(r); placed.current = true; return }
    const forward = l > left.get()
    const lead = { type: 'spring' as const, ...liquidDragLead }
    const trail = { type: 'spring' as const, ...liquidPillSpring }
    const a = animate(left, l, forward ? trail : lead)
    const b = animate(right, r, forward ? lead : trail)
    return () => { a.stop(); b.stop() }
  }, [target, fluid, left, right, items.length])

  // 旧说明先快速退场、新说明稍后进场，两行不在同一时刻叠在一起
  const enter = fluid ? { duration: 0.16, delay: 0.07 } : { duration: 0 }
  const leave = fluid ? { duration: 0.07 } : { duration: 0 }
  return <>
    <span className={styles.chooserText}><AnimatePresence initial={false}>
      <motion.span key={shown.value} className={styles.label} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0, transition: enter }} exit={{ opacity: 0, y: -3, transition: leave }}>{shown.description}</motion.span>
    </AnimatePresence></span>
    <div ref={host} className={styles.models} role="radiogroup" aria-label="伴奏生成模型" aria-busy={busy || undefined}>
      <motion.span className={styles.modelPill} data-armed={confirming || undefined} style={{ left, right }} aria-hidden="true" />
      {items.map(item => <button type="button" key={item.value} role="radio" data-model={item.value} className={styles.model}
        aria-checked={item.value === value} aria-disabled={item.disabled || busy || undefined} data-shown={item.value === target} data-armed={armed === item.value || undefined}
        aria-label={item.hint ? `${item.title}：${item.hint}` : item.title} title={item.title}
        onClick={() => press(item)}>
        {armed === item.value ? '确认生成' : item.label}
        {item.state === 'saved' && <svg className={styles.modelMark} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
        {(item.state === 'running' || item.state === 'failed') && <span className={styles.modelDot} data-state={item.state} aria-hidden="true" />}
      </button>)}
    </div>
    <p className={`${styles.hint} ${styles.status}`} role={shown.state === 'failed' ? 'alert' : undefined} title={shown.hint || undefined}>{busy ? '正在加入…' : shown.hint}</p>
  </>
}

function Check({ visible }: { visible: boolean }) {
  return <svg className={styles.check} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ visibility: visible ? 'visible' : 'hidden' }}><path d="m5 12 4 4L19 6" /></svg>
}
