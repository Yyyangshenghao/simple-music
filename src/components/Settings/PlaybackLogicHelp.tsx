import { useId, useRef } from 'react'
import styles from './PlaybackLogicHelp.module.css'

export function PlaybackLogicHelp({ providerLabels, preferOriginSource, multiSourceFallback, authPending }: {
  providerLabels: string[]
  preferOriginSource: boolean
  multiSourceFallback: boolean
  authPending: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = useId()
  const titleId = useId()
  const fallbackHint = authPending ? '等待账号核实'
    : providerLabels.length === 0 ? '暂无可用在线平台'
      : providerLabels.length === 1 ? '仅一个平台可用'
        : multiSourceFallback ? '失败后按排序补位' : '失败后停止'

  return (
    <>
      <button type="button" className={`${styles.trigger} no-drag`} aria-haspopup="dialog" aria-controls={dialogId}
        onClick={() => dialogRef.current?.showModal()}>
        <span aria-hidden="true">?</span>播放逻辑
      </button>
      <dialog ref={dialogRef} id={dialogId} className={styles.dialog} aria-labelledby={titleId}
        onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div>
              <span className={styles.eyebrow}>从点击歌曲到开始播放</span>
              <h2 id={titleId}>播放逻辑</h2>
            </div>
            <button type="button" className={styles.close} aria-label="关闭播放逻辑说明" onClick={() => dialogRef.current?.close()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <div className={styles.body}>
            <p className={styles.intro}>有缓存，先用缓存。<br /><span>没有，再按设置联网。</span></p>
            <ol className={styles.flow} aria-label="歌曲播放流程">
              <li>
                <span className={styles.stepNumber} aria-hidden="true">01</span>
                <strong>先找本地音频</strong>
                <p>本地歌曲直接播放<br />在线歌曲优先用完整缓存</p>
              </li>
              <li>
                <span className={styles.stepNumber} aria-hidden="true">02</span>
                <strong>再按设置联网</strong>
                <p>按起播方式选择<br />已启用的可用平台</p>
              </li>
              <li>
                <span className={styles.stepNumber} aria-hidden="true">03</span>
                <strong>失败时看换源设置</strong>
                <p>先试当前平台可用音质<br />{fallbackHint}</p>
              </li>
            </ol>
            <div className={styles.currentRule}>
              <span className={styles.ruleLabel}>你的联网设置</span>
              {authPending ? <p>正在核实平台账号…</p> : providerLabels.length === 0 ? <p>暂无可用在线平台，本地音频仍可播放。</p> : <>
                <strong>{preferOriginSource ? '歌曲原平台优先' : `${providerLabels[0]}优先`}</strong>
                <div className={styles.sourceOrder}>
                  <span>{preferOriginSource ? '补位顺序' : '平台顺序'}</span>
                  {providerLabels.map((label, index) => <span className={styles.source} key={label}>
                    {index > 0 && <span className={styles.arrow} aria-hidden="true">→</span>}{label}
                  </span>)}
                </div>
              </>}
            </div>
            <section className={styles.section}>
              <h3>两种方式，区别在第一步用谁</h3>
              <p className={styles.caption}>例如：无缓存，两个平台都可用，排序为网易云 → QQ。点击一首 QQ 的歌：</p>
              <div className={styles.examples}>
                <div className={preferOriginSource ? styles.selectedExample : undefined}>
                  <div className={styles.exampleHeading}><strong>跟随歌曲来源</strong>{preferOriginSource && <span>当前</span>}</div>
                  <p>先用 <b>QQ音乐</b></p><small>从哪找到，就先用哪</small>
                </div>
                <div className={!preferOriginSource ? styles.selectedExample : undefined}>
                  <div className={styles.exampleHeading}><strong>固定播放顺序</strong>{!preferOriginSource && <span>当前</span>}</div>
                  <p>先用 <b>网易云</b></p><small>先用排序第一的平台</small>
                </div>
              </div>
              <p className={styles.caption}>开启“自动换源”，失败后才会尝试另一平台的同歌版本。</p>
            </section>
            <div className={styles.notes}>
              <section>
                <h3>没保存过，也可能有缓存</h3>
                <p>在线播放时，完整下载成功的音频通常会自动缓存。<strong>不必听到结尾。</strong></p>
              </section>
              <section>
                <h3>只想这次换个平台？</h3>
                <p>用播放器里的<strong>“更多 → 本次优先”</strong>。其他平台的缓存会让路，全局顺序不变。</p>
              </section>
            </div>
            <details className={styles.details}>
              <summary>缓存与播放来源的补充说明</summary>
              <dl>
                <dt>哪些平台参与联网播放？</dt>
                <dd>只使用已登录、已启用且可播放的平台；原平台不可用时按排序选择。</dd>
                <dt>为什么来源不同？</dt>
                <dd>歌曲来源是你找到它的平台；音频可能来自换源后的缓存。“更多 → 播放来源”显示“本地离线”，表示正在用缓存。</dd>
                <dt>缓存会一直保留吗？</dt>
                <dd>下载未完成时不一定有缓存；容量满后会清理较久未使用的自动缓存。主动“保存到本地”的歌曲不受自动清理影响，在“设置 → 缓存与下载”中单独管理。</dd>
                <dt>本次优先还会影响什么？</dt>
                <dd>重载时保留进度与暂停状态。失败后是否换源，仍取决于“自动换源”开关。</dd>
              </dl>
            </details>
            <p className={styles.footer}>新设置下次起播生效 · 以上流程适用于网易云、QQ<br />Apple Music 使用独立官方播放器，不参与这里的换源与缓存。</p>
          </div>
        </div>
      </dialog>
    </>
  )
}
