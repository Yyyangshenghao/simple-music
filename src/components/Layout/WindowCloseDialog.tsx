import { useEffect, useRef, useState } from 'react'
import { useWindowCloseStore } from '../../stores/window-close'
import styles from './WindowCloseDialog.module.css'

export function WindowCloseDialog() {
  const promptId = useWindowCloseStore((s) => s.promptId)
  const pending = useWindowCloseStore((s) => s.pending)
  const error = useWindowCloseStore((s) => s.error)
  const resolve = useWindowCloseStore((s) => s.resolve)
  const [remember, setRemember] = useState(false)
  const [action, setAction] = useState<'tray' | 'quit'>('tray')
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
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not(:disabled), input:not(:disabled):not([type="radio"]), input[type="radio"]:checked:not(:disabled)')
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
      <form onSubmit={(event) => { event.preventDefault(); void resolve(action, remember) }}>
        <h2 id="window-close-title" className={styles.title}>关闭窗口</h2>
        <fieldset className={styles.options} disabled={pending} aria-label="关闭方式">
          <label className={styles.option}>
            <input type="radio" name="window-close-action" value="tray" checked={action === 'tray'} onChange={() => setAction('tray')} />
            缩回托盘
          </label>
          <label className={styles.option}>
            <input type="radio" name="window-close-action" value="quit" checked={action === 'quit'} onChange={() => setAction('quit')} />
            退出应用
          </label>
        </fieldset>
        <label className={styles.remember}>
          <input type="checkbox" checked={remember} disabled={pending} onChange={(event) => setRemember(event.target.checked)} />
          记住选择
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.footer}>
          <button ref={cancel} type="button" className={styles.cancel} disabled={pending} onClick={() => void resolve('cancel', false)}>取消</button>
          <button type="submit" className={styles.confirm} disabled={pending}>确定</button>
        </div>
      </form>
    </dialog>
  )
}
