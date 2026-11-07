import { useEffect, useRef, useState } from 'react'
import type { Track } from '../types/domain'
import type { SongComment, SongCommentsPage as CommentPage } from '../types/song-comments'
import { useProviderStore } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'
import { providerAccountSession } from '../lib/provider-account-session'
import { loadSongComments, mergeSongCommentsPage, songCommentKey, supportsSongComments } from '../lib/song-comments'
import { sizedImage } from '../lib/image-size'
import { ScrollArea } from '../components/ui/ScrollArea'
import { BackButton } from '../components/ui/BackButton'
import { SourceBadge } from '../components/ui/SourceBadge'
import { ActionButton } from '../components/ui/ActionButton'
import layout from './ToplistPage.module.css'
import styles from './SongCommentsPage.module.css'

function Comments({ title, comments }: { title: string; comments: SongComment[] }) {
  return <section className={styles.section} aria-label={title}>
    <h2>{title}</h2>
    <ul className={styles.list}>
      {comments.map(comment => {
        const date = new Date(comment.time)
        const showDate = comment.time > 0 && Number.isFinite(date.getTime())
        return <li className={styles.comment} key={songCommentKey(comment)}>
        {comment.user?.avatar ? <img className={styles.avatar} src={comment.user.avatar} alt="" loading="lazy" /> : <span className={styles.avatar} aria-hidden="true" />}
        <div className={styles.body}>
          <div className={styles.meta}>
            <span className={styles.nickname}>{comment.user?.nickname || '音乐用户'}</span>
            {showDate && <time dateTime={date.toISOString()}>{date.toLocaleDateString('zh-CN')}</time>}
            {comment.likedCount > 0 && <span className={styles.likes}>{comment.likedCount.toLocaleString('zh-CN')} 人赞过</span>}
          </div>
          <p className={styles.content}>{comment.content}</p>
        </div>
      </li>})}
    </ul>
  </section>
}

export function SongCommentsPage({ track }: { track: Track }) {
  const runtime = useProviderStore(state => supportsSongComments(track) ? state.byId[track.source as 'netease' | 'qq'] : null)
  const account = useProviderStore(() => supportsSongComments(track) ? providerAccountSession(track.source as 'netease' | 'qq') : 0)
  const [result, setResult] = useState<{ page: CommentPage; runtime: typeof runtime; account: number; track: Track } | null>(null)
  const page = result?.runtime === runtime && result.account === account && result.track === track ? result.page : null
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const allowed = !!runtime?.enabled && runtime.auth === 'authenticated'

  useEffect(() => {
    const current = ++generation.current
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    busy.current = false
    setResult(null)
    setFailed(false)
    setLoading(allowed)
    if (allowed) {
      busy.current = true
      void loadSongComments(track, { signal: controller.signal })
        .then(next => {
          if (current === generation.current) setResult({ page: mergeSongCommentsPage({ comments: [], hotComments: next.hotComments, total: next.total }, next), runtime, account, track })
        })
        .catch(error => { if (current === generation.current && !controller.signal.aborted && error?.name !== 'AbortError') setFailed(true) })
        .finally(() => { if (current === generation.current) { busy.current = false; setLoading(false) } })
    }
    return () => { generation.current++; controller.abort() }
  }, [track, runtime, account, allowed, revision])

  useEffect(() => () => { request.current?.abort() }, [])

  async function loadMore() {
    if (busy.current || !allowed || page?.nextOffset === undefined) return
    const current = generation.current
    const controller = new AbortController()
    request.current = controller
    busy.current = true
    setLoading(true)
    setFailed(false)
    try {
      const next = await loadSongComments(track, { offset: page.nextOffset, signal: controller.signal })
      if (current === generation.current) setResult({ page: mergeSongCommentsPage(page, next), runtime, account, track })
    } catch (error) {
      if (current === generation.current && !controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) setFailed(true)
    } finally {
      if (current === generation.current) { busy.current = false; setLoading(false) }
    }
  }

  return <ScrollArea className={`${layout.page} ${styles.page}`}>
    <BackButton autoHide={false} iconOnly className={layout.back} onClick={() => useNavigationStore.getState().goBack()} ariaLabel="返回上一页" />
    <header className={`${layout.group} ${styles.header}`}>
      {track.cover && <img className={styles.cover} src={sizedImage(track.cover, 160)} alt="" />}
      <div className={styles.identity}>
        <h1>{track.name || '待加载歌曲'}</h1>
        <p className={styles.track}><span>歌曲评论</span>{track.artist && <span>{track.artist}</span>}<SourceBadge source={track.source} reveal /></p>
      </div>
    </header>
    <div className={`${layout.group} ${styles.comments}`}>
      {!supportsSongComments(track) ? <p className={styles.status}>这个来源暂不提供歌曲评论。</p>
        : !allowed ? <p className={styles.status}>请登录并启用歌曲所属平台后查看评论。</p>
          : <>
            {!!page?.hotComments.length && <Comments title="热评" comments={page.hotComments} />}
            {!!page?.comments.length && <Comments title={page.total === null ? '最新评论' : `最新评论 · ${page.total.toLocaleString('zh-CN')}`} comments={page.comments} />}
            {loading && <p className={styles.status} role="status">正在读取评论…</p>}
            {failed && <div className={styles.recovery} role="status"><span>{page ? '下一页评论暂时无法加载' : '评论暂时无法加载'}</span><ActionButton label="重试" compact onClick={() => page ? void loadMore() : setRevision(value => value + 1)} /></div>}
            {!loading && !failed && page && page.comments.length === 0 && page.hotComments.length === 0 && <p className={styles.status}>还没有歌曲评论。</p>}
            {page?.nextOffset !== undefined && !failed && <div className={styles.more}><ActionButton label={loading ? '正在加载…' : '加载更多评论'} disabled={loading} onClick={() => void loadMore()} /></div>}
          </>}
    </div>
  </ScrollArea>
}
