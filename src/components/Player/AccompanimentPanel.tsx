import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '../../stores/player'
import { useTaskCenterStore } from '../../stores/task-center'
import { useKaraokeStore } from '../../stores/karaoke'
import { useKaraokeModelsStore } from '../../stores/karaoke-models'
import { DEFAULT_KARAOKE_BACKING, DEFAULT_KARAOKE_LEAD, useSettingsStore } from '../../stores/settings'
import { openAccompanimentsLibrary, useNavigationStore } from '../../stores/navigation'
import { useToastStore } from '../../stores/toast'
import { accompanimentId, accompanimentOriginal, accompanimentsForTrack } from '../../lib/karaoke-library'
import { HoverTips } from '../ui/HoverTips'
import { ActionButton } from '../ui/ActionButton'
import { SettingSlider } from '../ui/SettingSlider'
import { sameKaraokeTrack, type KaraokeModelId } from '../../types/karaoke'
import type { Track } from '../../types/domain'
import styles from './AccompanimentPanel.module.css'

const MODEL_NAMES: Record<KaraokeModelId, string> = { hq3: 'HQ3 标准', 'hq3-fp16': 'HQ3 省显存', kara2: 'Kara2 保留和声' }
const MODEL_SHORT: Record<KaraokeModelId, string> = { hq3: '标准', 'hq3-fp16': '省显存', kara2: '保留和声' }
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
  const current = models.find(model => model.id === selected)
  const job = jobs.find(job => job.model === selected && sameKaraokeTrack(job.track, original))
  const saved = entries.some(item => item.model === selected && item.available)
  const hasPlayable = entries.some(item => item.available)
  const unsupported = current?.requiresF16 && f16 === false
  const modelName = (id: KaraokeModelId) => models.find(model => model.id === id)?.name ?? MODEL_NAMES[id]
  const notify = (error: unknown) => useToastStore.getState().show(error instanceof Error ? error.message : '操作失败，请重试')

  // 选择后保持面板打开，便于接着调节保留比例或对比其他版本。
  async function choose(id: string | null) {
    try { await select(id, expectedKey) } catch (error) { notify(error) }
  }
  async function generate() {
    if (pending.current) return
    pending.current = true
    setAdding(true)
    try {
      await enqueue(original, selected)
    } catch (error) { notify(error) }
    finally { pending.current = false; setAdding(false) }
  }
  const openQueue = () => { onClose(); useTaskCenterStore.getState().show('karaoke', job ? `k:${job.id}` : undefined) }
  const openLibrary = () => { onClose(); openAccompanimentsLibrary() }
  const openSettings = () => { onClose(); const nav = useNavigationStore.getState(); nav.requestSettingsKaraoke(); nav.navigateTo('settings') }
  const failed = !unsupported && job?.phase === 'failed'
  const status = unsupported ? '当前显卡不支持此模型，请选择其他版本。'
    : job ? '进度、暂停与重试可在任务队列中管理。'
    : current && current.state !== 'ready' && !saved ? `首次使用需下载约 ${Math.round(current.bytes / 1024 / 1024)} MB 模型。` : ''
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
          <span className={styles.versionInfo}><span className={styles.versionTitle}><strong>伴奏</strong><span className={styles.modelTag}>{MODEL_NAMES[item.model]}</span></span>
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
        <span className={styles.label}>{hasPlayable ? '生成其他版本' : '去除人声，生成伴奏'}</span>
        {models.length > 1 && <ModelPicker value={selected} disabled={!modelsLoaded || adding} onChange={setModel}
          items={models.map(model => ({ value: model.id, label: MODEL_SHORT[model.id], title: model.name, disabled: model.requiresF16 && f16 === false }))} />}
        <button type="button" className={styles.generate} data-primary={!hasPlayable && !saved}
          aria-busy={adding || undefined} disabled={adding || (!job && (!loaded || !!error || !current || !!unsupported || saved))}
          onClick={() => job ? openQueue() : void generate()}>{adding ? '正在加入…' : job ? failed ? '生成失败，查看队列' : '查看生成任务' : saved ? '此版本已生成' : '生成伴奏'}</button>
        {/* 状态说明固定占一行：切换模型时说明出现或消失，面板高度不变，浮层不跳动。 */}
        <p className={`${styles.hint} ${styles.status}`} role={failed ? 'alert' : undefined} title={status || undefined}>{status}</p>
        {modelError && <p className={styles.hint} role="alert">{modelError} <button type="button" className={styles.link} onClick={() => void loadModels()}>重试</button></p>}
      </div>
    </div>
    <div className={styles.foot}>
      <button type="button" className={styles.footLink} onClick={openLibrary}>我的伴奏</button>
      <button type="button" className={styles.footLink} onClick={openQueue}>任务队列</button>
      <ActionButton label="伴奏设置" title="伴奏设置 · 模型与保存位置" icon="settings" iconOnly compact onClick={openSettings} />
    </div>
  </div>
}

/** 模型是生成参数：用轻量分段控件，选中只抬起一层浅底，不鼓起、不加粗，把强调留给版本选择与生成按钮。 */
function ModelPicker({ items, value, disabled, onChange }: {
  items: { value: KaraokeModelId; label: string; title: string; disabled: boolean }[]
  value: KaraokeModelId
  disabled: boolean
  onChange(value: KaraokeModelId): void
}) {
  return <div className={styles.models} role="radiogroup" aria-label="伴奏生成模型" aria-disabled={disabled || undefined}>
    {items.map(item => <button type="button" key={item.value} role="radio" className={styles.model}
      aria-checked={item.value === value} title={item.title} disabled={disabled || item.disabled}
      onClick={() => { if (item.value !== value) onChange(item.value) }}>{item.label}</button>)}
  </div>
}

function Check({ visible }: { visible: boolean }) {
  return <svg className={styles.check} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ visibility: visible ? 'visible' : 'hidden' }}><path d="m5 12 4 4L19 6" /></svg>
}
