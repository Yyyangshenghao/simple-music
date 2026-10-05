import { getReleaseHistory } from '../../lib/release-history'
import type { ReleaseChangeType } from '../../lib/release-history'
import styles from './ReleaseHistory.module.css'

const CHANGE_TYPES: { type: ReleaseChangeType; label: string; icon: string }[] = [
  { type: 'feat', label: '新增', icon: '+' },
  { type: 'perf', label: '优化', icon: '↗' },
  { type: 'fix', label: '修复', icon: '✓' },
  { type: 'note', label: '说明', icon: '·' },
]

export function ReleaseHistory({ currentVersion }: { currentVersion: string }) {
  const releases = getReleaseHistory(currentVersion)

  return (
    <section className={styles.history} aria-labelledby="release-history-heading">
      <header className={styles.header}>
        <div>
          <h3 id="release-history-heading">版本记录</h3>
        </div>
        <span className={styles.offline}>离线可读</span>
      </header>
      {releases.length === 0 ? (
        <p className={styles.empty}>此版本暂无更新记录。</p>
      ) : releases.map((release) => {
        const groups = CHANGE_TYPES.map((kind) => ({
          ...kind,
          updates: release.updates.filter((update) => update.type === kind.type),
        })).filter((group) => group.updates.length > 0)
        return (
          <details key={release.version} className={styles.release} open={release.version === currentVersion}>
            <summary className={`${styles.summary} no-drag`}>
              <span className={styles.version}>v{release.version}</span>
              {release.version === currentVersion && <span className={styles.current}>当前版本</span>}
              <span className={styles.mix}>
                {groups.map((group) => (
                  <span key={group.type} className={styles.chip} data-change-type={group.type}>
                    {group.label} <b>{group.updates.length}</b>
                  </span>
                ))}
              </span>
              <svg className={styles.chevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="m9 5 7 7-7 7" />
              </svg>
            </summary>
            <div className={styles.body}>
              {groups.map((group) => (
                <section key={group.type} className={styles.changeGroup} data-change-type={group.type} aria-label={group.label}>
                  <h4 className={styles.groupHeading}>
                    <span className={styles.groupIcon} aria-hidden="true">{group.icon}</span>
                    {group.label}
                  </h4>
                  <ul className={styles.updates}>
                    {group.updates.map((update, index) => (
                      <li key={index}>
                        {update.title && <strong className={styles.updateTitle}>{update.title}</strong>}
                        <p>{update.description}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {release.compatibility.length > 0 && (
                <div className={styles.compatibility}>
                  <h4>兼容说明</h4>
                  <ul>{release.compatibility.map((note, index) => <li key={index}>{note}</li>)}</ul>
                </div>
              )}
            </div>
          </details>
        )
      })}
    </section>
  )
}
