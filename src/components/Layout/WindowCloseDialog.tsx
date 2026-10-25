import { useEffect, useRef, useState } from 'react'
import { useWindowCloseStore } from '../../stores/window-close'
import { JellyRadio, type JellyRadioItem } from '../ui/JellyRadio'
import { SpringCheck } from '../ui/SpringCheck'
import styles from './WindowCloseDialog.module.css'

type CloseAction = 'tray' | 'quit'

const CLOSE_OPTIONS: JellyRadioItem<CloseAction>[] = [
  {
    value: 'tray',
    label: '最小化到托盘',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 14V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v9M3 17v3h18v-3M12 9v7m-3-3 3 3 3-3" />
    </svg>
  },
  {
    value: 'quit',
    label: '退出应用',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v9M7 5.5a8 8 0 1 0 10 0" />
    </svg>
  }
]

export function WindowCloseDialog() {
  const promptId = useWindowCloseStore((s) => s.promptId)
  const pending = useWindowCloseStore((s) => s.pending)
  const error = useWindowCloseStore((s) => s.error)
  const resolve = useWindowCloseStore((s) => s.resolve)
  const [remember, setRemember] = useState(false)
  const [action, setAction] = useState<CloseAction>('tray')
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setRemember(false)
    setAction('tray')
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
      aria-busy={pending}
      onCancel={(event) => { event.preventDefault(); void resolve('cancel', false) }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form onSubmit={(event) => { event.preventDefault(); void resolve(action, remember) }}>
        <h2 id="window-close-title" className={styles.title}>关闭窗口</h2>
        <JellyRadio<CloseAction> className={styles.options} items={CLOSE_OPTIONS} value={action} onChange={setAction} ariaLabel="关闭方式" block disabled={pending} />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.footer}>
          <div>
            <label className={styles.remember}>
              <SpringCheck checked={remember} disabled={pending} aria-describedby="window-close-settings-hint" onChange={setRemember} />
              记住选择
            </label>
            <p id="window-close-settings-hint" className={styles.rememberHint}>之后可在设置中更改</p>
          </div>
          <div className={styles.actions}>
            <button ref={cancel} type="button" className={styles.cancel} disabled={pending} onClick={() => void resolve('cancel', false)}>取消</button>
            <button type="submit" className={styles.confirm} disabled={pending}>{pending ? '处理中…' : '确定'}</button>
          </div>
        </div>
      </form>
    </dialog>
  )
}
