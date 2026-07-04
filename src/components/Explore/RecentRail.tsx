import styles from './RecentRail.module.css'

/** 最近播放占位：先占住布局位置，数据后续用网易 record_recent_song 接入。 */
export function RecentRail() {
  return (
    <section className={styles.rail}>
      <h2 className={styles.title}>最近播放</h2>
      <div className={styles.row}>
        {Array.from({ length: 5 }, (_, i) => <div key={i} className={styles.placeholder} />)}
      </div>
      <p className={styles.hint}>即将上线</p>
    </section>
  )
}
