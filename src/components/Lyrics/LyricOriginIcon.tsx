import type { LyricOrigin } from '../../types/lyrics-source'
import { AppleMusicIcon, KugouLogo, NeteaseLogo, QQMusicLogo, QishuiLogo } from '../ui/brand-logos'
import styles from './LyricOriginIcon.module.css'

/** 歌词来源图标：音乐平台与酷狗用官方图标；AMLL 歌词库与本地没有品牌图形，用中性底的字母/音符标。 */
export function LyricOriginIcon({ origin, dim, small }: { origin: LyricOrigin | 'auto'; dim?: boolean; small?: boolean }) {
  return (
    <span className={styles.icon} data-dim={dim || undefined} data-small={small || undefined} aria-hidden="true">
      {origin === 'netease' ? <NeteaseLogo className={styles.logo} />
        : origin === 'qq' ? <QQMusicLogo className={styles.logo} />
        : origin === 'apple' ? <AppleMusicIcon className={styles.logo} />
        : origin === 'kugou' ? <KugouLogo className={styles.logo} />
        : origin === 'qishui' ? <QishuiLogo className={styles.logo} />
        : origin === 'auto' ? (
          <span className={styles.tile}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3.5 13.6 8a2 2 0 0 0 1.3 1.3l4.6 1.6-4.6 1.6a2 2 0 0 0-1.3 1.3L12 18.5l-1.6-4.6a2 2 0 0 0-1.3-1.3L4.5 11l4.6-1.6A2 2 0 0 0 10.4 8z" />
              <path d="M18.5 16.5v4M16.5 18.5h4" />
            </svg>
          </span>
        )
        : <span className={styles.tile}>{origin === 'local' ? '♪' : 'A'}</span>}
    </span>
  )
}

/** 行内「图标 + 来源名」，用于说明文字里点名某个来源 */
export function LyricOriginInline({ origin, children }: { origin: LyricOrigin; children: React.ReactNode }) {
  return <span className={styles.inline}><LyricOriginIcon origin={origin} small />{children}</span>
}

/** 图标 + 文本两列；来源行内容外包一层，保持原按钮的纵向排版不变。 */
export function LyricOriginRow({ origin, dim, children }: { origin: LyricOrigin | 'auto'; dim?: boolean; children: React.ReactNode }) {
  return (
    <span className={styles.row}>
      <LyricOriginIcon origin={origin} dim={dim} />
      <span className={styles.text}>{children}</span>
    </span>
  )
}
