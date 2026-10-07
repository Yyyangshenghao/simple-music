import { describe, expect, it } from 'vitest'
import { version } from '../../package.json'
import { buildReleaseHistory, getReleaseHistory } from './release-history'

const notes = `## 更新日志

- 新增 **更新日志**，保留 \`some_setting\` 设置。
- 可离线查看 [历史版本](https://example.com/releases)。
  不需要登录。

## 兼容说明

- 保留账号与本地音乐。

## 验证情况

- 测试通过，仅供开发者查看。
`

describe('离线发行历史', () => {
  it('按版本数值倒序排列，只展示当前版本及更早的发行说明', () => {
    const releases = buildReleaseHistory({
      '/docs/release-notes-2.2.9.md': notes,
      '/docs/release-notes-2.3.0.md': notes,
      '/docs/release-notes-2.2.10.md': notes,
      '/docs/release-notes-2.3.1.md': notes,
      '/docs/release-notes-draft.md': notes,
    }, '2.3.0')
    expect(releases.map((entry) => entry.version)).toEqual(['2.3.0', '2.2.10', '2.2.9'])
  })

  it('展示用户更新与兼容说明，合并换行并保留代码标识，不展示验收记录', () => {
    expect(buildReleaseHistory({ '/docs/release-notes-2.3.0.md': notes.replace(/\n/g, '\r\n') }, '2.3.0')).toEqual([{
      version: '2.3.0',
      updates: [
        { type: 'feat', description: '新增 更新日志，保留 some_setting 设置。' },
        { type: 'note', description: '可离线查看 历史版本。 不需要登录。' },
      ],
      compatibility: ['保留账号与本地音乐。'],
    }])
  })

  it('按作者的显式类别拆分标题与描述，不被描述内的其他类别词误导', () => {
    const categorized = `## 更新日志
- 新增 · 把喜欢的歌留下来：离线音乐库管理已保存歌曲。
- 优化 · 少等一会儿：启动更快，切歌更顺。
- 修复 · 字体跟着你走：新增字体配置时正确保留旧设置。
- 说明 · 老习惯还在：已有账号与数据继续保留。
## 兼容说明
- 无需迁移。
## 验证情况
- 不展示这条验收记录。
`
    expect(buildReleaseHistory({ '/docs/release-notes-2.3.0.md': categorized }, '2.3.0')[0].updates).toEqual([
      { type: 'feat', title: '把喜欢的歌留下来', description: '离线音乐库管理已保存歌曲。' },
      { type: 'perf', title: '少等一会儿', description: '启动更快，切歌更顺。' },
      { type: 'fix', title: '字体跟着你走', description: '新增字体配置时正确保留旧设置。' },
      { type: 'note', title: '老习惯还在', description: '已有账号与数据继续保留。' },
    ])
  })

  it('兼容 feat/fix 标记与无标题的旧文案，不将不明确的变化误报为新功能', () => {
    const legacy = `## 更新日志
- feat: 新增快捷键
- fix: 修复切歌错误
- 支持桌面歌词
- 优化启动速度
- 保持头像原有尺寸
`
    const updates = buildReleaseHistory({ '/docs/release-notes-2.3.0.md': legacy }, '2.3.0')[0].updates
    expect(updates.map((update) => update.type)).toEqual(['feat', 'fix', 'feat', 'perf', 'note'])
    expect(updates.every((update) => update.title === undefined)).toBe(true)
    expect(updates[4].description).toBe('保持头像原有尺寸')
  })

  it('兼容 2.0.0 的主要变化标题，忽略没有更新内容的文件', () => {
    const releases = buildReleaseHistory({
      '/docs/release-notes-2.0.0.md': notes.replace('## 更新日志', '## 主要变化'),
      '/docs/release-notes-2.0.1.md': '## 验证情况\n\n- 测试通过',
    }, '2.3.0')
    expect(releases).toHaveLength(1)
    expect(releases[0].updates).toHaveLength(2)
    expect(buildReleaseHistory({}, '2.3.0')).toEqual([])
  })

  it('实际打包的发行说明覆盖当前版本和历史版本，无需联网取数', () => {
    const releases = getReleaseHistory(version)
    expect(releases[0].version).toBe(version)
    expect(releases[0].updates.length).toBeGreaterThan(0)
    expect(releases[0].compatibility.length).toBeGreaterThan(0)
    expect(releases.some((entry) => entry.version === '2.0.0')).toBe(true)
  })
})
