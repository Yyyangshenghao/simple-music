import { useEffect, useRef, useState } from 'react'
import { useWindowCloseStore } from '../../stores/window-close'
import styles from './WindowCloseDialog.module.css'

export function WindowCloseDialog() {
  const promptId = useWindowCloseStore((s) => s.promptId)
  const pending = useWindowCloseStore((s) => s.pending)
  const error = useWindowCloseStore((s) => s.error)
  const resolve = useWindowCloseStore((s) => s.resolve)
  const [remember, setRemember] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setRemember(false)
    const element = dialog.current
    if (promptId === null || !element) return
    element.showModal()
    cancel.current?.focus()
    return () => { if (element.open) element.close() }
  }, [promptId])

  if (promptId === null) return null

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} no-drag`}
      data-window-close
      aria-labelledby="window-close-title"
      aria-describedby="window-close-description"
      aria-busy={pending}
      onCancel={(event) => { event.preventDefault(); void resolve('cancel', false) }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not(:disabled), input:not(:disabled)')
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (!first || !last) return
        if (event.shiftKey && event.target === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <div className={styles.header}>
        <span className={styles.mark} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 15v4h14v-4M12 4v10m-4-4 4 4 4-4" />
          </svg>
        </span>
        <div>
          <h2 id="window-close-title">关闭窗口后</h2>
          <p id="window-close-description">让音乐继续，或结束这次聆听。</p>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.tray} disabled={pending} onClick={() => void resolve('tray', remember)}>
          <strong>缩回托盘</strong>
          <span>音乐继续播放，点击托盘图标可回来</span>
          <span className={styles.arrow} aria-hidden="true">↗</span>
        </button>
        <button type="button" className={styles.quit} disabled={pending} onClick={() => void resolve('quit', remember)}>
          <strong>退出应用</strong>
          <span>停止播放并关闭 Simple Music</span>
        </button>
      </div>
      <label className={styles.remember}>
        <input type="checkbox" checked={remember} disabled={pending} onChange={(event) => setRemember(event.target.checked)} />
        记住这次选择
      </label>
      <p className={styles.hint}>可在「设置 → 界面与窗口 → 关闭窗口」中修改。</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.footer}>
        <button ref={cancel} type="button" className={styles.cancel} disabled={pending} onClick={() => void resolve('cancel', false)}>取消</button>
      </div>
    </dialog>
  )
}
