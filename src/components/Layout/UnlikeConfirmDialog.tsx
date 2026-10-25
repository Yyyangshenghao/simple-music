import { useEffect, useRef, useState } from 'react'
import { useLikesStore } from '../../stores/likes'
import dialogStyles from './WindowCloseDialog.module.css'
import styles from './UnlikeConfirmDialog.module.css'

export function UnlikeConfirmDialog() {
  const prompt = useLikesStore((s) => s.unlikePrompt)
  const resolve = useLikesStore((s) => s.resolveUnlike)
  const [skip, setSkip] = useState(false)
  const [pending, setPending] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const keep = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setSkip(false)
    setPending(false)
    const element = dialog.current
    if (!prompt || !element) return
    element.showModal()
    keep.current?.focus()
    return () => { if (element.open) element.close() }
  }, [prompt?.id])

  if (!prompt) return null
  const source = prompt.track.source === 'qq' ? 'QQ 音乐' : '网易云音乐'
  const decide = async (confirm: boolean) => {
    if (pending) return
    setPending(true)
    try { await resolve(prompt.id, confirm, confirm && skip) }
    finally { setPending(false) }
  }

  return (
    <dialog
      ref={dialog}
      className={`${dialogStyles.dialog} ${styles.dialog} no-drag`}
      data-unlike-confirm
      aria-labelledby="unlike-confirm-title"
      aria-describedby="unlike-confirm-description"
      aria-busy={pending}
      onCancel={(event) => { event.preventDefault(); void decide(false) }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) void decide(false)
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form onSubmit={(event) => { event.preventDefault(); void decide(true) }}>
        <h2 id="unlike-confirm-title" className={dialogStyles.title}>取消红心？</h2>
        <p className={styles.track} title={prompt.track.name}>{prompt.track.name}</p>
        <p className={styles.artist}>{prompt.track.artist || '未知歌手'} · {source}</p>
        <p id="unlike-confirm-description" className={styles.description}>这首歌将从{source}的“我喜欢”中移除。</p>
        <label className={dialogStyles.remember}>
          <input type="checkbox" checked={skip} disabled={pending} onChange={(event) => setSkip(event.target.checked)} />
          不再提示（可在设置中恢复）
        </label>
        <div className={dialogStyles.footer}>
          <button ref={keep} type="button" className={dialogStyles.cancel} disabled={pending} onClick={() => void decide(false)}>保留红心</button>
          <button type="submit" className={dialogStyles.confirm} disabled={pending}>取消红心</button>
        </div>
      </form>
    </dialog>
  )
}
