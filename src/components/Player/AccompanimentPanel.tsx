import { useEffect, useState } from 'react'
import { usePlayerStore } from '../../stores/player'
import { useKaraokeStore } from '../../stores/karaoke'
import { useKaraokeModelsStore } from '../../stores/karaoke-models'
import { DEFAULT_KARAOKE_BACKING, DEFAULT_KARAOKE_LEAD, useSettingsStore } from '../../stores/settings'
import { useNavigationStore } from '../../stores/navigation'
import { useToastStore } from '../../stores/toast'
import { accompanimentId, accompanimentOriginal, accompanimentsForTrack } from '../../lib/karaoke-library'
import type { KaraokeJobPhase } from '../../lib/karaoke/queue'
import { SettingSlider } from '../ui/SettingSlider'
import { ACCOMPANIMENTS_PLAYLIST_ID, sameKaraokeTrack, type KaraokeModelId } from '../../types/karaoke'
import type { Track } from '../../types/domain'
import styles from './AccompanimentPanel.module.css'

const MODEL_NAMES: Record<KaraokeModelId, string> = { hq3: 'HQ3 标准', 'hq3-fp16': 'HQ3 省显存', kara2: 'Kara2 保留和声' }
const MODEL_SHORT: Record<KaraokeModelId, string> = { hq3: '标准', 'hq3-fp16': '省显存', kara2: '保留和声' }
export const KARAOKE_PHASE: Record<KaraokeJobPhase, string> = { queued: '等待生成', 'waiting-memory': '等待内存释放', resolving: '正在读取歌曲', model: '正在下载模型', preparing: '正在准备模型', decoding: '正在解码音频', separating: '正在生成伴奏', saving: '正在保存', failed: '生成失败' }
/** 只有这两个阶段上报真实进度，其余阶段显示不定进度。 */
export const KARAOKE_MEASURED: KaraokeJobPhase[] = ['model', 'separating']

export function AccompanimentPanel({ track, onClose }: { track: Track; onClose(): void }) {
  const { items, jobs, loaded, error, paused, load, enqueue, retry, cancel } = useKaraokeStore()
  const { models, f16, loaded: modelsLoaded, error: modelError, load: loadModels } = useKaraokeModelsStore()
  const accompaniment = usePlayerStore(s => s.accompaniment)
  const select = usePlayerStore(s => s.selectAccompaniment)
  const selected = useSettingsStore(s => s.karaokeModel)
  const setModel = useSettingsStore(s => s.setKaraokeModel)
  const lead = useSettingsStore(s => s.karaokeLead)
  const backing = useSettingsStore(s => s.karaokeBacking)
  const setVocalMix = useSettingsStore(s => s.setKaraokeVocalMix)
  const [adding, setAdding] = useState(false)
  useEffect(() => { void load().catch(() => {}); void loadModels() }, [load, loadModels])
  const original = accompanimentOriginal(track) ?? track
  const entries = accompanimentsForTrack(track, items)
  const activeId = accompanimentId(accompaniment ?? track)
  const expectedKey = `${track.source}:${String(track.id)}`
  const current = models.find(model => model.id === selected)
  const job = jobs.find(job => job.model === selected && sameKaraokeTrack(job.track, original))
  const running = job && job.phase !== 'failed' ? job : null
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
    setAdding(true)
    try {
      if (job?.phase === 'failed') retry(job.id)
      else await enqueue(original, selected)
    } catch (error) { notify(error) }
    finally { setAdding(false) }
  }
  const openLibrary = () => { onClose(); useNavigationStore.getState().navigateTo({ type: 'app-playlist', id: ACCOMPANIMENTS_PLAYLIST_ID }) }
  const openSettings = () => { onClose(); const nav = useNavigationStore.getState(); nav.requestSettingsKaraoke(); nav.navigateTo('settings') }
  const measured = running && KARAOKE_MEASURED.includes(running.phase)
  const failed = !unsupported && job?.phase === 'failed'
  const status = unsupported ? '当前显卡不支持此模型，请选择其他版本。'
    : failed ? job?.error ?? '生成失败'
    : running ? paused && running.phase === 'queued' ? '队列已暂停，可到“我的伴奏”继续。' : '可以关闭面板或切歌，生成会在后台继续。'
    : current && current.state !== 'ready' && !saved ? `首次使用需下载约 ${Math.round(current.bytes / 1024 / 1024)} MB 模型。` : ''
  const playing = entries.find(item => item.id === activeId)
  const mixReason = !playing ? '播放伴奏时可调' : !playing.vocals ? '此版本较早，重新生成后可调' : ''
  const percent = (value: number) => `${Math.round(value * 100)}%`
  return <div className={styles.panel} role="dialog" aria-label="选择伴奏版本">
    <div className={styles.head}>
      <div className={styles.heading}><span className={styles.eyebrow}>伴奏</span><strong className={styles.song} title={original.name}>{original.name}</strong></div>
      <button type="button" className={styles.close} aria-label="关闭伴奏版本" onClick={onClose}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
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
        {models.length > 1 && <ModelPicker value={selected} disabled={!modelsLoaded} onChange={setModel}
          items={models.map(model => ({ value: model.id, label: MODEL_SHORT[model.id], title: model.name, disabled: model.requiresF16 && f16 === false }))} />}
        {running ? <div className={styles.progress} role="status" aria-label="伴奏生成进度">
          <div className={styles.progressText}><span>{KARAOKE_PHASE[running.phase]}</span>
            <span className={styles.progressEnd}>{measured && <span className={styles.percent}>{Math.round(running.progress * 100)}%</span>}
              {/* 保存阶段队列不接受取消（文件可能已写成），按钮随之隐藏。 */}
              {running.phase !== 'saving' && <button type="button" className={styles.cancel} onClick={() => cancel(running.id)}>取消</button>}</span></div>
          <div className={styles.track} data-indeterminate={!measured}><span className={styles.fill} style={measured ? { transform: `scaleX(${Math.max(0.02, running.progress)})` } : undefined} /></div>
        </div>
          : <button type="button" className={styles.generate} data-primary={!hasPlayable && !saved} disabled={adding || !loaded || !!error || !current || !!unsupported || saved}
            onClick={() => void generate()}>{adding ? '正在加入…' : saved ? '此版本已生成' : job ? '重试生成' : '生成伴奏'}</button>}
        {/* 状态说明固定占一行：切换模型时说明出现或消失，面板高度不变，浮层不跳动。 */}
        <p className={`${styles.hint} ${styles.status}`} role={failed ? 'alert' : undefined} title={status || undefined}>{status}</p>
        {modelError && <p className={styles.hint} role="alert">{modelError} <button type="button" className={styles.link} onClick={() => void loadModels()}>重试</button></p>}
      </div>
    </div>
    <div className={styles.foot}>
      <button type="button" className={styles.footLink} onClick={openLibrary}>我的伴奏</button>
      <button type="button" className={styles.footLink} onClick={openSettings}>模型与保存位置</button>
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
