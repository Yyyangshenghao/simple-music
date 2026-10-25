import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// 执行发布工作流里的真实校验，避免本地检查与 CI 使用不同规则。
const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
const validator = workflow.match(/node - "\$NOTES_FILE" <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/)?.[1]
if (!validator) throw new Error('未找到发布说明校验脚本')

const summaries = [
  '- 新增：动态歌词样式。',
  '- 新增：歌词来源选择。',
  '- 优化：背景与设置。',
  '- 修复：音质与缓存。',
]

function validate(updates: string, compatibility = '- 保留现有设置。', verification = '- 已完成本地检查。') {
  const dir = mkdtempSync(join(tmpdir(), 'simplemusic-release-notes-'))
  try {
    const file = join(dir, 'notes.md')
    writeFileSync(file, `## 更新日志\n\n${updates}\n\n## 兼容说明\n\n${compatibility}\n\n## 验证情况\n\n${verification}\n`)
    return spawnSync(process.execPath, ['-', file], { input: validator, encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('发布说明工作流校验', () => {
  it('兼容只有四条摘要的既有发行说明', () => {
    expect(validate(summaries.join('\n')).status).toBe(0)
  })

  it('四条短摘要后允许分组的完整更新记录，详情不受摘要长度限制', () => {
    const details = `\n\n### 动态歌词\n\n- 新增：${'详细功能说明'.repeat(20)}。\n\n### 播放与界面\n\n- 修复：缓存音质。`
    const result = validate(summaries.join('\n') + details)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('分组详情不能掩盖摘要数量不正确的问题', () => {
    const details = '\n\n### 详细更新\n\n- 新增：歌词样式。'
    expect(validate(summaries.slice(0, 3).join('\n') + details).status).not.toBe(0)
    expect(validate([...summaries, '- 说明：第五条摘要。'].join('\n') + details).status).not.toBe(0)
  })

  it('仍拒绝超过 72 字符的摘要和非列表摘要', () => {
    expect(validate([`- 新增：${'字'.repeat(72)}`, ...summaries.slice(1)].join('\n')).status).not.toBe(0)
    expect(validate(['新增：没有列表标记。', ...summaries.slice(1)].join('\n')).status).not.toBe(0)
  })

  it('仍要求非空的兼容说明和验证情况', () => {
    expect(validate(summaries.join('\n'), '').status).not.toBe(0)
    expect(validate(summaries.join('\n'), '- 保留现有设置。', '').status).not.toBe(0)
  })
})
