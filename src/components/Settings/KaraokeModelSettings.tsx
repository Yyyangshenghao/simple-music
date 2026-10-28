import { useEffect } from 'react'
import { motion } from 'motion/react'
import { useKaraokeModelsStore } from '../../stores/karaoke-models'
import { useSettingsStore } from '../../stores/settings'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { InfoButton } from '../ui/InfoButton'
import type { KaraokeModelView } from '../../types/karaoke'
import page from '../../pages/SettingsPage.module.css'
import styles from './KaraokeModelSettings.module.css'
import { useKaraokeStore } from '../../stores/karaoke'
import { useToastStore } from '../../stores/toast'
import { openAccompanimentsLibrary } from '../../stores/navigation'

const MB = 1024 * 1024

function formatSize(bytes: number): string {
  return bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`
}

function formatVram(mb: number): string {
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

/** 设置「K 歌模型」：下载、卸载、选用分离模型，并管理各模型分离出的伴奏。 */
export function KaraokeModelSettings() {
  const { models, loaded, error, f16, busy, load, install, uninstall } = useKaraokeModelsStore()
  const { items, directory, directoryNotice, load: loadLibrary, setDirectory, jobs } = useKaraokeStore()
  const selected = useSettingsStore(state => state.karaokeModel)
  const setKaraokeModel = useSettingsStore(state => state.setKaraokeModel)

  useEffect(() => { void load(); void loadLibrary().catch(() => {}) }, [load, loadLibrary])

  const stemBytes = items.reduce((sum, item) => sum + item.bytes, 0)
  const stemCount = items.length

  async function remove(model: KaraokeModelView) {
    if (!window.confirm(`卸载「${model.name}」后，再次生成需要重新下载模型。已保存的伴奏会保留，仍要卸载吗？`)) return
    await uninstall(model.id)
    if (model.id === selected) {
      const fallback = useKaraokeModelsStore.getState().models.find(item => item.id !== model.id && item.state === 'ready')
      setKaraokeModel(fallback?.id ?? 'hq3')
    }
  }

  async function chooseDirectory() {
    try {
      const result = await window.desktop?.selectDirectory({ title: '选择伴奏保存文件夹', defaultPath: directory })
      if (result?.ok && result.filePath) await setDirectory(result.filePath)
      else if (result?.error) throw new Error(result.error)
    } catch (error) { useToastStore.getState().show(error instanceof Error ? error.message : '目录设置失败') }
  }

  return (
    <section id="settings-detail-karaoke-models" className={page.group}>
      <h3 className={page.groupTitle}>
        K 歌模型
        <InfoButton label="K 歌模型" text="为歌曲生成伴奏时使用所选模型；未安装时先下载。切换模型只影响之后加入的任务，已有伴奏会保留。生成会临时占用较多内存，任务逐首处理。" />
      </h3>
      <div data-setting-row className={page.row}>
        <span className={page.rowLabel}>伴奏保存位置<InfoButton label="伴奏保存位置" text="更改位置只影响之后加入的任务，已有伴奏和队列中的保存位置保持不变。伴奏文件不会随缓存清理或模型卸载而删除。" /></span>
        <span className={styles.directory} title={directory}>{directory || '正在读取…'}</span>
        <span className={styles.actions}>
          <button className={`${page.storageAction} no-drag`} disabled={!directory} onClick={() => void window.desktop?.openDirectory(directory)}>打开文件夹</button>
          <button className={`${page.storageAction} no-drag`} disabled={!window.desktop?.selectDirectory} onClick={() => void chooseDirectory()}>更改目录</button>
        </span>
      </div>
      {directoryNotice && <div className={page.row}><span className={page.rowValue}>{directoryNotice}</span></div>}
      {!loaded && <div className={page.row}><span className={page.rowValue}>正在读取…</span></div>}
      {error && <div className={page.row}><span className={styles.error}>{error}</span></div>}
      <div role="radiogroup" aria-label="K 歌模型" className={styles.list}>
        {models.map((model) => {
          const unsupported = model.requiresF16 && f16 === false
          const active = model.id === selected
          const progress = model.bytes ? Math.min(1, model.receivedBytes / model.bytes) : 0
          return (
            <div key={model.id} data-setting-row className={`${page.row} ${styles.model}`}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                disabled={unsupported}
                className={`${styles.pick} no-drag`}
                onClick={() => setKaraokeModel(model.id)}
              >
                <span className={styles.radio} data-checked={active} aria-hidden />
                <span className={styles.text}>
                  <span data-setting-label className={styles.name}>
                    {model.name}
                    {active && <span className={styles.badge}>新任务使用</span>}
                  </span>
                  <span className={styles.desc}>{model.description}</span>
                  <span className={styles.meta}>
                    {unsupported
                      ? '当前显卡不支持半精度计算，无法使用'
                      : `${formatSize(model.bytes)} · 分离时显存约 ${formatVram(model.peakVramMb)}`}
                  </span>
                  {model.state === 'error' && <span className={styles.error}>{model.error ?? '下载失败'}</span>}
                </span>
              </button>
              <span className={styles.actions}>
                {model.state === 'downloading' && (
                  <>
                    <span className={styles.progress} aria-label={`已下载 ${Math.round(progress * 100)}%`}>
                      <span style={{ transform: `scaleX(${progress})` }} />
                    </span>
                    <span className={page.rowValue}>{Math.round(progress * 100)}%</span>
                    <button className={`${page.storageAction} ${page.actionQuiet} no-drag`} onClick={() => void uninstall(model.id)}>取消</button>
                  </>
                )}
                {(model.state === 'missing' || model.state === 'error') && (
                  <motion.button className={`${page.storageAction} no-drag`} disabled={unsupported} onClick={() => void install(model.id)} whileTap={tapScale} transition={springSnappy}>
                    {model.state === 'error' ? '重新下载' : '下载'}
                  </motion.button>
                )}
                {model.state === 'ready' && (
                  <button className={`${page.storageAction} ${page.actionDanger} no-drag`} disabled={busy === model.id || jobs.some(job => job.model === model.id && !['queued', 'waiting-memory', 'failed'].includes(job.phase))} onClick={() => void remove(model)}>
                    {busy === model.id ? '卸载中…' : '卸载'}
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <div data-setting-row className={page.row}>
        <span className={page.rowLabel}>
          已生成的伴奏
          <InfoButton label="已生成的伴奏" text="在“我的库 · 应用歌单 · 伴奏”中播放或删除各模型版本。已生成的伴奏长期保留，不会自动淘汰。" />
        </span>
        <span className={page.rowValue}>{stemCount ? `${formatSize(stemBytes)} · ${stemCount} 个版本` : '暂无'}</span>
        <button className={`${page.storageAction} no-drag`} onClick={openAccompanimentsLibrary}>
          我的伴奏
        </button>
      </div>
    </section>
  )
}
