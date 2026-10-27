import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useKaraokeStore } from '../../stores/karaoke'
import { useKaraokeModelsStore } from '../../stores/karaoke-models'
import { DEFAULT_KARAOKE_BACKING, DEFAULT_KARAOKE_LEAD, useSettingsStore } from '../../stores/settings'
import { useNavigationStore } from '../../stores/navigation'
import { useToastStore } from '../../stores/toast'
import { accompanimentId, accompanimentOriginal, accompanimentsForTrack } from '../../lib/karaoke-library'
import type { KaraokeJobPhase } from '../../lib/karaoke/queue'
import { springGentle } from '../../lib/motion-presets'
import { useMotion } from '../../hooks/useMotion'
import { JellyRadio } from '../ui/JellyRadio'
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
  const animated = useMotion('pageTransitionMotion')
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

  async function choose(id: string | null) {
    try { const request = select(id, expectedKey); onClose(); await request } catch (error) { notify(error) }
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
  const playing = entries.find(item => item.id === activeId)
  const percent = (value: number) => `${Math.round(value * 100)}%`
  return <motion.div className={styles.panel} role="dialog" aria-modal="true" aria-label="选择伴奏版本"
    initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
    transition={animated ? springGentle : { duration: 0 }}>
    <div className={styles.head}>
      <div className={styles.heading}><span className={styles.eyebrow}>伴奏</span><strong className={styles.song} title={original.name}>{original.name}</strong></div>
      <button type="button" className={styles.close} aria-label="关闭伴奏版本" onClick={onClose}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    </div>
    <div className={styles.body}>
      <div className={styles.versions}>
        <button type="button" className={styles.version} data-current={!activeId} aria-pressed={!activeId} onClick={() => void choose(null)}>
          <span className={styles.versionInfo}><strong>原曲</strong></span><Check visible={!activeId} />
        </button>
        {entries.map(item => <button type="button" key={item.id} className={styles.version} data-current={activeId === item.id} aria-pressed={activeId === item.id}
          disabled={!item.available} aria-label={`使用伴奏：${modelName(item.model)}`} title={modelName(item.model)}
          onClick={() => void choose(item.id)}>
          <span className={styles.versionInfo}><strong>伴奏 · {MODEL_SHORT[item.model]}</strong>
            <small>{item.available ? new Date(item.generatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '文件已丢失，可重新生成'}</small></span>
          <Check visible={activeId === item.id} />
        </button>)}
        {!loaded && <p className={styles.hint} role="status">正在读取伴奏…</p>}
        {error && <p className={styles.hint} role="alert">{error} <button type="button" className={styles.link} onClick={() => void load().catch(() => {})}>重试</button></p>}
      </div>
      {playing && <div className={styles.section}>
        <span className={styles.label}>保留人声</span>
        {playing.vocals ? <>
          <div className={styles.mixRow}><span className={styles.mixName} title="左右声像上的叠轨、和声与 ad-lib">和声</span>
            <SettingSlider value={backing} min={0} max={1} step={0.01} defaultValue={DEFAULT_KARAOKE_BACKING} scale={100} unit="%"
              ariaLabel="和声保留" format={percent} onChange={value => setVocalMix(lead, value)} /></div>
          <div className={styles.mixRow}><span className={styles.mixName} title="居中的主唱">导唱</span>
            <SettingSlider value={lead} min={0} max={1} step={0.01} defaultValue={DEFAULT_KARAOKE_LEAD} scale={100} unit="%"
              ariaLabel="导唱保留" format={percent} onChange={value => setVocalMix(value, backing)} /></div>
        </> : <p className={styles.hint}>这个版本生成较早，没有保存人声轨。在“我的伴奏”删除后重新生成即可调节。</p>}
      </div>}
      <div className={styles.section}>
        <span className={styles.label}>{hasPlayable ? '生成其他版本' : '去除人声，生成伴奏'}</span>
        {models.length > 1 && <JellyRadio size="sm" block className={styles.models} ariaLabel="伴奏生成模型" value={selected} disabled={!modelsLoaded} onChange={setModel}
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
        {unsupported ? <p className={styles.hint}>当前显卡不支持此模型，请选择其他版本。</p>
          : job?.phase === 'failed' ? <p className={styles.hint} role="alert">{job.error ?? '生成失败'}</p>
          : running ? <p className={styles.hint}>{paused && running.phase === 'queued' ? '队列已暂停，可到“我的伴奏”继续。' : '可以关闭面板或切歌，生成会在后台继续。'}</p>
          : current && current.state !== 'ready' && !saved && <p className={styles.hint}>首次使用需下载约 {Math.round(current.bytes / 1024 / 1024)} MB 模型。</p>}
        {modelError && <p className={styles.hint} role="alert">{modelError} <button type="button" className={styles.link} onClick={() => void loadModels()}>重试</button></p>}
      </div>
    </div>
    <div className={styles.foot}>
      <button type="button" className={styles.footLink} onClick={openLibrary}>我的伴奏</button>
      <button type="button" className={styles.footLink} onClick={openSettings}>模型与保存位置</button>
    </div>
  </motion.div>
}

function Check({ visible }: { visible: boolean }) {
  return <svg className={styles.check} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ visibility: visible ? 'visible' : 'hidden' }}><path d="m5 12 4 4L19 6" /></svg>
}
