import { useId, useState, type CSSProperties } from 'react'
import styles from './RoamSaveHelp.module.css'

const HELP_TEXT = '漫游先保存为应用歌单。全部歌曲来自网易云或全部来自 QQ 音乐且已登录时，可在「管理与同步」中手动同步；QQ 顺序以云端为准，混合歌单保存在应用中。'
const characters = Array.from(HELP_TEXT)

export function RoamSaveHelp() {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div className={styles.help} data-open={open}>
      <button
        type="button"
        className={`${styles.trigger} no-drag`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg>
        保存与同步说明
      </button>
      <p id={panelId} role="note" aria-hidden={!open} aria-label={HELP_TEXT} className={styles.panel}>
        <span aria-hidden="true">
          {characters.map((character, index) => (
            <span
              key={index}
              className={styles.character}
              style={{
                '--reveal-delay': `${index * 6}ms`,
                '--hide-delay': `${(characters.length - index - 1) * 2}ms`
              } as CSSProperties}
            >{character}</span>
          ))}
        </span>
      </p>
    </div>
  )
}
