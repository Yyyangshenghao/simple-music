/**
 * 歌词匹配真实数据评测：用应用自己的歌词来源查询（queryLyricsSource）对 cases.ts 里的歌曲逐个取词，
 * 统计配对正确、漏配与配错。走真实网络（网易云、QQ 游客接口、AMLL、酷狗），不属于 npm test。
 *
 *   npm run eval:lyrics                      # 全部用例
 *   npm run eval:lyrics -- --only 日文,版本陷阱   # 只跑指定分类或用例 id
 *   npm run eval:lyrics -- --json report.json  # 另存完整结果
 *   npm run eval:lyrics -- --only ja-1 --verbose # 打印各来源的原因与歌词开头
 *
 * 判定：期望命中的用例，网易云或 QQ 至少一个来源取到歌词，且对上的曲目标题主体与歌手都正确；
 * 任何来源对上了歌手不符或版本不符的曲目都记为「配错」——这是最需要为零的指标。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { CASES, type EvalCase } from './cases'

const values = new Map<string, string>()
Object.assign(globalThis, {
  DOMParser,
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
  },
})

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
const verbose = args.includes('--verbose')
// QQ 游客接口并发高了会限流，默认两路。
const concurrency = Number(args.includes('--concurrency') ? args[args.indexOf('--concurrency') + 1] : 2)

// 隔离的 server：空用户目录，不带任何账号 Cookie。
const { startServer } = await import('../../server/index')
const server = await startServer({ port: 0, userDataDir: mkdtempSync(join(tmpdir(), 'lyrics-eval-')) })
Object.assign(globalThis, { window: { desktop: { serverPort: server.port } } })

const { useProviderStore } = await import('../../src/stores/providers')
const { useSettingsStore } = await import('../../src/stores/settings')
const { queryLyricsSource } = await import('../../src/lib/lyrics-source-query')
const { normalizeMatchText } = await import('../../src/lib/match-text')
const { api } = await import('../../src/lib/api')
type Track = import('../../src/types/domain').Track

useProviderStore.setState({ byId: {
  netease: { enabled: false, auth: 'unauthenticated' },
  qq: { enabled: false, auth: 'unauthenticated' },
  apple: { enabled: false, auth: 'unauthenticated' },
} } as never)
useSettingsStore.setState({
  lyricsGuestSources: { netease: true, qq: true },
  lyricsPlatformSources: { netease: true, qq: true, apple: true },
  lyricsAmllFallback: true,
  lyricsKugouFallback: true,
} as never)

const SOURCES = ['netease', 'qq'] as const
const LYRIC_ORIGINS = ['netease', 'qq', 'amll', 'kugou'] as const

async function search(source: 'netease' | 'qq', keyword: string): Promise<Track[]> {
  const res = await api.get<{ songs?: Track[] }>(source === 'qq' ? '/api/qq/search' : '/api/search', { keywords: keyword, limit: 20, guest: '1' })
  return (res.songs ?? []).map(track => ({ ...track, source, provider: source }))
}

const text = (value: unknown) => normalizeMatchText(String(value ?? ''))
const artistText = (track: Track) => [track.artist, ...(track.artists ?? []).flatMap(a => [a.name, ...(a.aliases ?? [])])].map(text).join('|')
const sameTitle = (track: Track, title: string) => text(track.name) === text(title)

/** 参考曲目：参考平台上歌名一致、歌手包含期望歌手的第一条结果，提供真实时长与平台 ID。 */
async function reference(item: EvalCase): Promise<Track | null> {
  const source = item.ref ?? 'qq'
  // 限流时退避重试，避免把请求失败记成「未收录」。
  for (let attempt = 0; ; attempt++) {
    try {
      const found = await search(source, `${item.title} ${item.artist}`)
      return found.find(track => sameTitle(track, item.title) && artistText(track).includes(text(item.artist))) ?? null
    } catch (error) {
      if (attempt >= 3) throw error
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
    }
  }
}

function originOf(item: EvalCase, ref: Track): Track {
  if (item.origin !== 'apple') return ref
  const name = item.as?.name ?? item.title
  const artist = item.as?.artist ?? item.artist
  return {
    source: 'apple', provider: 'apple', type: 'song',
    id: item.appleId ?? `i.eval-${item.id}`, ...(item.appleId ? { catalogId: item.appleId } : {}),
    name, artist, artists: artist.split(/\s*[&,、]\s*/).map((part, index) => ({ id: `a${index}`, name: part })),
    album: item.as?.album, duration: Number(ref.duration) + (item.as?.durationOffsetMs ?? 350),
  }
}

interface SourceOutcome { origin: string; status: string; message?: string; head?: string[]; match?: string; lines: number; words: boolean; translation: boolean; verdict: 'ok' | 'wrong' | 'unverified' | 'none' }
interface CaseOutcome { item: EvalCase; ref?: string; skipReason?: string; outcomes: SourceOutcome[]; result: 'pass' | 'miss' | 'wrong' | 'skip'; ms: number }

function judge(item: EvalCase, match: Track | undefined): SourceOutcome['verdict'] {
  if (!match) return 'unverified'
  if (!artistText(match).includes(text(item.artist))) return 'wrong'
  if (item.expect === 'version') return text(match.name).includes(text(item.marker ?? '')) ? 'ok' : 'wrong'
  if (item.expect === 'none') return 'wrong'
  return text(match.name).includes(text(item.title)) ? 'ok' : 'wrong'
}

async function runCase(item: EvalCase): Promise<CaseOutcome> {
  const started = Date.now()
  let ref: Track | null
  try { ref = await reference(item) } catch (error) {
    return { item, outcomes: [], result: 'skip', skipReason: `参考搜索失败：${error instanceof Error ? error.message : String(error)}`, ms: Date.now() - started }
  }
  if (!ref) return { item, outcomes: [], result: 'skip', skipReason: '参考平台未收录', ms: Date.now() - started }
  const origin = originOf(item, ref)
  const outcomes: SourceOutcome[] = []
  for (const lyricOrigin of LYRIC_ORIGINS) {
    if (lyricOrigin === origin.source) continue
    const res = await queryLyricsSource(origin, lyricOrigin, [...SOURCES]).catch(error => ({ status: 'error', message: String(error) }) as never)
    const lyrics = res.status === 'ready' ? res.result : undefined
    const verdict = res.status !== 'ready' ? 'none' : judge(item, res.match)
    outcomes.push({
      origin: lyricOrigin, status: res.status, message: res.message,
      head: lyrics?.main.slice(0, 4).map(line => `${line.time.toFixed(1)} ${line.text}`),
      match: res.match ? `${res.match.name} / ${res.match.artist}` : undefined,
      lines: lyrics?.main.length ?? 0,
      words: !!lyrics?.wordLines.some(line => line.words.length),
      translation: !!lyrics?.aligned.some(line => line.text),
      verdict,
    })
  }
  const platformOk = outcomes.some(o => (o.origin === 'netease' || o.origin === 'qq') && o.verdict === 'ok')
  const anyWrong = outcomes.some(o => o.verdict === 'wrong')
  const result = anyWrong ? 'wrong'
    : item.expect === 'none' ? (outcomes.some(o => o.status === 'ready') ? 'wrong' : 'pass')
      : item.expect === 'version' || item.expect === 'safe' ? 'pass'
        : platformOk ? 'pass' : 'miss'
  return { item, ref: `${ref.source}:${ref.name} / ${ref.artist} ${Math.round(Number(ref.duration) / 1000)}s`, outcomes, result, ms: Date.now() - started }
}

const selected = CASES.filter(item => !only || only.includes(item.category) || only.includes(item.id))
const results: CaseOutcome[] = []
let cursor = 0
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
  while (cursor < selected.length) {
    const item = selected[cursor++]
    const outcome = await runCase(item)
    results.push(outcome)
    const mark = { pass: '✓', miss: '·', wrong: '✗', skip: '–' }[outcome.result]
    const detail = outcome.outcomes.map(o => `${o.origin}:${o.status}${o.verdict === 'wrong' ? '!' : ''}${o.lines ? `(${o.lines}${o.words ? 'w' : ''}${o.translation ? 't' : ''})` : ''}`).join(' ')
    console.log(`${mark} [${item.category}] ${item.id} ${item.title} / ${item.as?.artist ?? item.artist} — ${outcome.result === 'skip' ? outcome.skipReason : detail}`)
    for (const o of outcome.outcomes.filter(o => o.verdict === 'wrong')) console.log(`    配错 ${o.origin}: ${o.match}`)
    if (verbose) {
      console.log(`    参考 ${outcome.ref ?? '—'}`)
      for (const o of outcome.outcomes) console.log(`    ${o.origin}: ${o.status}${o.message ? `（${o.message}）` : ''}${o.match ? ` → ${o.match}` : ''}${o.head ? `\n      ${o.head.join('\n      ')}` : ''}`)
    }
  }
}))

server.close()
const order = [...new Set(CASES.map(item => item.category))]
console.log('\n分类汇总（通过/漏配/配错/跳过）')
for (const category of order) {
  const rows = results.filter(r => r.item.category === category)
  if (!rows.length) continue
  const count = (kind: CaseOutcome['result']) => rows.filter(r => r.result === kind).length
  console.log(`  ${category.padEnd(8, '　')} ${count('pass')}/${count('miss')}/${count('wrong')}/${count('skip')}`)
}
const total = (kind: CaseOutcome['result']) => results.filter(r => r.result === kind).length
console.log(`合计 ${results.length} 首：通过 ${total('pass')}，漏配 ${total('miss')}，配错 ${total('wrong')}，跳过 ${total('skip')}`)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2))
process.exit(total('wrong') ? 1 : 0)
