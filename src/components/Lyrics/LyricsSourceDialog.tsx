import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '../../stores/player'
import { useLyricsSourceStore } from '../../stores/lyrics-source'
import { useLyricsSourceDialogStore } from '../../stores/lyrics-source-dialog'
import { useNavigationStore } from '../../stores/navigation'
import { useToastStore } from '../../stores/toast'
import { LYRIC_SOURCE_LABELS, type LyricOrigin, type LyricSourceCandidate } from '../../types/lyrics-source'
import type { Track } from '../../types/domain'
import styles from './LyricsSourceDialog.module.css'

const STATUS_LABELS = {
  idle: '尚未查询', loading: '查找中…', ready: '逐行', empty: '未收录', mismatch: '未找到同曲同版本',
  error: '连接失败', disabled: '已停用', login: '需登录', unavailable: '当前不可用',
}

function candidateDescription(candidate: LyricSourceCandidate): string {
  if (candidate.status !== 'ready') return candidate.message || STATUS_LABELS[candidate.status]
  return [candidate.wordTimed ? '逐字' : '逐行', candidate.hasTranslation && '翻译', candidate.hasRomaji && '音译'].filter(Boolean).join(' · ')
}

function openSettings(section: 'lyrics' | 'music') {
  useLyricsSourceDialogStore.getState().close()
  const navigation = useNavigationStore.getState()
  if (section === 'lyrics') navigation.requestSettingsLyrics()
  else navigation.requestSettingsMusic()
  navigation.navigateTo('settings')
}

/** 每次打开或切歌都创建独立草稿；关闭会取消尚未提交的选择。 */
export function LyricsSourceDialog() {
  const open = useLyricsSourceDialogStore((s) => s.open)
  const track = usePlayerStore((s) => s.currentTrack)
  useEffect(() => { if (open && !track) useLyricsSourceDialogStore.getState().close() }, [open, track])
  if (!open || !track) return null
  return <LyricsSourceSelection key={`${track.source}:${String(track.id)}`} track={track} />
}

export function LyricsSourceSelection({ track }: { track: Track }) {
  const trackKey = `${track.source}:${String(track.id)}`
  const token = useRef(crypto.randomUUID()).current
  const dialog = useRef<HTMLDialogElement>(null)
  const active = useRef(true)
  const candidates = useLyricsSourceStore((s) => s.candidateTrackKey === trackKey && s.candidateToken === token ? s.candidates : [])
  const appliedOrigin = useLyricsSourceStore((s) => s.appliedOrigin)
  const requestedOrigin = useLyricsSourceStore((s) => s.requestedOrigin)
  const remembered = useLyricsSourceStore((s) => s.remembered[trackKey])
  const defaultSource = useLyricsSourceStore((s) => s.defaultSource)
  const appliedPreference = useLyricsSourceStore((s) => s.appliedPreference)
  const fallbackReason = useLyricsSourceStore((s) => s.fallbackReason)
  const [selected, setSelected] = useState<LyricOrigin | 'auto'>(requestedOrigin)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectedCandidate = candidates.find((candidate) => candidate.origin === (selected === 'auto' ? appliedOrigin : selected))
  const savedSelection = selected !== 'auto' && remembered?.origin === selected
  const sameSelection = selected === requestedOrigin && (selected === 'auto' || selected === appliedOrigin)
  const defaultChanged = selected === 'auto' && defaultSource !== appliedPreference
  const canApply = !busy && (selected === 'auto'
    ? requestedOrigin !== 'auto' || !!remembered || defaultChanged
    : selectedCandidate?.status === 'ready' && (!sameSelection || (remember && !savedSelection)))
  const close = () => {
    active.current = false
    useLyricsSourceStore.getState().cancelSelection(token)
    useLyricsSourceDialogStore.getState().close()
  }

  useEffect(() => {
    active.current = true
    const element = dialog.current
    element?.showModal()
    void useLyricsSourceStore.getState().queryCandidates(trackKey, token).catch(() => {
      if (active.current) setError('来源查询失败，请重试')
    })
    return () => {
      active.current = false
      useLyricsSourceStore.getState().cancelSelection(token)
      if (element?.open) element.close()
    }
  }, [trackKey, token])

  const query = (origin?: LyricOrigin) => {
    void useLyricsSourceStore.getState().queryCandidates(trackKey, token, origin).catch(() => {
      if (active.current) setError('来源查询失败，请重试')
    })
  }
  const apply = async () => {
    if (!canApply) return
    setBusy(true)
    setError('')
    try {
      const result = await useLyricsSourceStore.getState().chooseSource(trackKey, token, selected, remember)
      if (!active.current) return
      let message = selected === 'auto' ? '已恢复自动选择' : remember
        ? result.saved ? '已切换，下次仍使用此来源' : '已切换，但未能记住选择，请重试保存'
        : '已切换，仅本次使用'
      if (result.offsetReset) message += '；歌词同步偏移已归零'
      close()
      useToastStore.getState().show(message)
    } catch {
      if (active.current) setError('切换失败，仍使用原歌词。请重试。')
    } finally {
      if (active.current) setBusy(false)
    }
  }
  const applyLabel = busy ? '正在切换…' : selected === 'auto'
    ? defaultChanged && requestedOrigin === 'auto' && !remembered ? '应用当前默认规则' : '恢复自动选择'
    : sameSelection ? '保存选择' : '使用此歌词'

  return (
    <dialog ref={dialog} className={`${styles.dialog} no-drag`} aria-labelledby="lyrics-source-title" aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
      }}>
      <header className={styles.header}>
        <div className={styles.heading}><h2 id="lyrics-source-title">选择歌词</h2><p title={`${track.name} · ${track.artist}`}>{track.name} · {track.artist || '未知歌手'}</p></div>
        <button type="button" className={styles.close} aria-label="关闭歌词选择" onClick={close}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {remembered && fallbackReason && <p className={styles.notice} role="status">{fallbackReason}。{appliedOrigin ? `当前使用${LYRIC_SOURCE_LABELS[appliedOrigin]}` : '暂无可用歌词'}</p>}
      <div className={styles.body}>
        <div className={styles.sources} role="radiogroup" aria-label="歌词来源">
          <button type="button" role="radio" aria-checked={selected === 'auto'} className={styles.source} data-selected={selected === 'auto'} disabled={busy} onClick={() => { setSelected('auto'); setError('') }}>
            <span className={styles.sourceHead}><span>自动选择</span>{requestedOrigin === 'auto' && <small>当前规则</small>}</span>
            <span className={styles.sourceHint}>{defaultSource === 'auto' ? '按默认规则选择' : `优先${LYRIC_SOURCE_LABELS[defaultSource]}`}</span>
          </button>
          {candidates.map((candidate) => <div className={styles.sourceItem} key={candidate.origin}>
            <button type="button" role="radio" aria-checked={selected === candidate.origin} className={styles.source} data-selected={selected === candidate.origin} disabled={busy} onClick={() => {
              setSelected(candidate.origin)
              setError('')
              if (candidate.status === 'ready' || candidate.status === 'idle') query(candidate.origin)
            }}>
              <span className={styles.sourceHead}><span>{LYRIC_SOURCE_LABELS[candidate.origin]}</span><span className={styles.badges}>
                {appliedOrigin === candidate.origin && <small>使用中</small>}{remembered?.origin === candidate.origin && <small>已记住</small>}
              </span></span>
              <span className={styles.sourceHint}>{candidateDescription(candidate)}</span>
            </button>
            {selected === candidate.origin && ['error', 'empty', 'mismatch'].includes(candidate.status) && <button className={styles.sourceAction} disabled={busy} onClick={() => query(candidate.origin)}>重试</button>}
            {selected === candidate.origin && (candidate.status === 'login' || (candidate.status === 'unavailable' && candidate.message === '需启用可匹配的平台')) && <button className={styles.sourceAction} onClick={() => openSettings('music')}>音源设置…</button>}
            {selected === candidate.origin && candidate.status === 'disabled' && <button className={styles.sourceAction} onClick={() => openSettings(candidate.origin === 'amll' || candidate.origin === 'kugou' ? 'lyrics' : 'music')}>前往启用…</button>}
          </div>)}
          {candidates.length === 0 && <>
            <p className={styles.sourceHint} role="status">{error ? '未能获取来源信息' : '正在查找歌词来源…'}</p>
            {error && <button className={styles.sourceAction} onClick={() => { setError(''); query() }}>重试查询</button>}
          </>}
        </div>
        <section className={styles.preview} aria-label="歌词预览" aria-live="polite">
          <h3>预览</h3>
          {selectedCandidate?.status === 'ready' ? <>
            <p className={styles.capabilities}>{candidateDescription(selectedCandidate)}</p>
            <div className={styles.previewLines}>{selectedCandidate.preview.map((line, index) => <div key={`${line.time}:${index}`} className={styles.line}>
              <time>{`${Math.floor(line.time / 60)}:${String(Math.floor(line.time % 60)).padStart(2, '0')}`}</time><p>{line.text}</p>
              {line.translation && <span>{line.translation}</span>}{line.romaji && <span>{line.romaji}</span>}
            </div>)}</div>
            <details className={styles.details}><summary>歌曲与来源详情</summary>
              <p>{selectedCandidate.matchedName || track.name} · {selectedCandidate.matchedArtist || track.artist}</p>
              <p>正文：{LYRIC_SOURCE_LABELS[selectedCandidate.origin]}</p>
              {selectedCandidate.hasTranslation && <p>翻译：{LYRIC_SOURCE_LABELS[selectedCandidate.translationOrigin ?? selectedCandidate.origin]}</p>}
              {selectedCandidate.hasRomaji && <p>音译：{LYRIC_SOURCE_LABELS[selectedCandidate.romajiOrigin ?? selectedCandidate.origin]}</p>}
            </details>
          </> : <p className={styles.previewEmpty}>{selectedCandidate ? candidateDescription(selectedCandidate) : '选择来源后可预览歌词，播放中的歌词保持不变。'}</p>}
          {track.source === 'local' && <p className={styles.capabilities}>本地歌词读取同名 .lrc 或文件内嵌的同步歌词；在线来源按文件标签匹配，只发送歌名、歌手与时长，不上传文件或路径</p>}
        </section>
      </div>
      <footer className={styles.footer}>
        <div className={styles.saveOptions}>
          {selected !== 'auto' && <label className={styles.remember}><input type="checkbox" checked={remember} disabled={busy} onChange={(event) => setRemember(event.target.checked)} />下次仍使用</label>}
          {selected !== 'auto' && !remember && remembered && <p className={styles.hint}>下次仍按已记住的{LYRIC_SOURCE_LABELS[remembered.origin]}</p>}
          <button className={styles.settingsLink} type="button" onClick={() => openSettings('lyrics')}>默认选择设置…</button>
        </div>
        <div className={styles.applyArea}>{error && <p role="alert" className={styles.error}>{error}</p>}<button type="button" className={styles.apply} disabled={!canApply} onClick={() => void apply()}>{applyLabel}</button></div>
      </footer>
    </dialog>
  )
}
