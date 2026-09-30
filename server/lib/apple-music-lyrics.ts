import type { ServerContext } from '../types'
import { AppleMusicError } from './apple-music'

type Page = { data?: Array<{ id?: string; attributes?: { ttml?: unknown } }> }

/** 非公开歌词能力只使用已有官网会话，失败不撤销播放授权。 */
export async function fetchAppleMusicLyrics(ctx: ServerContext, id: string, library: boolean): Promise<{ ttml: string }> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new AppleMusicError(400, '无效的 Apple Music 歌曲编号')
  const session = ctx.appleMusicWeb
  if (!session || ctx.appleMusicLoginMode === 'developer') return { ttml: '' }
  const state = session.state()
  if (!state.loggedIn || !/^[a-z]{2}$/.test(state.storefront)) return { ttml: '' }
  let expired = false
  const fetchLyrics = async () => {
    let song = id
    if (library) {
      const page = await session.catalog(`/v1/me/library/songs/${id}/catalog`) as Page
      song = page?.data?.[0]?.id ?? ''
      if (!/^[0-9]+$/.test(song)) return { ttml: '' }
    }
    for (const kind of ['syllable-lyrics', 'lyrics']) {
      if (expired || !session.state().loggedIn) break
      try {
        const page = await session.catalog(`/v1/catalog/${state.storefront}/songs/${song}/${kind}`) as Page
        const ttml = page?.data?.[0]?.attributes?.ttml
        if (typeof ttml === 'string' && ttml.length <= 2_000_000 && ttml.trim()) return { ttml }
      } catch { /* 无逐字歌词或端点不可用时尝试行级歌词。 */ }
    }
    return { ttml: '' }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fetchLyrics().catch(() => ({ ttml: '' })),
      new Promise<{ ttml: string }>(resolve => {
        timer = setTimeout(() => { expired = true; resolve({ ttml: '' }) }, 8000)
      }),
    ])
  } finally { clearTimeout(timer) }
}
