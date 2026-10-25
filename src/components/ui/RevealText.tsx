import { useMemo, type CSSProperties } from 'react'
import { useSettingsStore } from '../../stores/settings'
import styles from './RevealText.module.css'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const MAX_CHARACTERS = 120

export function RevealText({ text }: { text: string }) {
  const enabled = useSettingsStore((s) => s.performance.textRevealMotion)
  const parts = useMemo(() => {
    if (!enabled) return []
    const characters: string[] = []
    for (const part of segmenter.segment(text)) {
      if (characters.length === MAX_CHARACTERS) {
        characters.push(text.slice(part.index))
        break
      }
      characters.push(part.segment)
    }
    return characters
  }, [text, enabled])

  if (!enabled) return <span className={styles.text}>{text}</span>

  return (
    <span className={styles.text}>
      <span className={styles.accessibleText}>{text}</span>
      <span aria-hidden="true">
        {parts.map((part, index) => (
          <span key={index} className={styles.character} style={{
            '--reveal-delay': `${Math.min(index * 6, 300)}ms`,
            '--hide-delay': `${Math.min((parts.length - index - 1) * 2, 120)}ms`
          } as CSSProperties}>{part}</span>
        ))}
      </span>
    </span>
  )
}
