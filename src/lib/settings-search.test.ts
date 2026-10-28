import { describe, expect, it } from 'vitest'
import { groupSettingsResults, searchSettings, settingsMatchParts, type SearchableSetting } from './settings-search'

const entry = (label: string, description = '', sectionLabel = '界面与窗口', detailLabel = '主题与布局'): SearchableSetting => ({
  label, description, sectionLabel, detailLabel, section: 'visual',
})

describe('设置搜索', () => {
  const transparency = entry('减少透明度', '关闭毛玻璃的背景模糊和折射')
  const opacity = entry('底板不透明度', '', '界面与窗口', '迷你播放条')

  it('优先返回名称精确匹配，同时支持说明和分组路径', () => {
    expect(searchSettings([opacity, transparency], '减少透明度')).toEqual([transparency])
    expect(searchSettings([opacity, transparency], '玻璃')).toEqual([transparency])
    expect(searchSettings([opacity, transparency], '迷你 透明')).toEqual([opacity])
    expect(searchSettings([entry('别的设置', '减少透明度'), transparency], '减少透明度')[0]).toBe(transparency)
  })

  it('忽略首尾空格与英文大小写，多个关键词必须全部匹配', () => {
    const apple = entry('Apple Music', '登录与订阅', '音源与播放', '音源与账户')
    expect(searchSettings([apple], '  ＡＰＰＬＥ   登录  ')).toEqual([apple])
    expect(searchSettings([apple], 'apple 缓存')).toEqual([])
    expect(searchSettings([{ ...entry('播放 / 暂停'), controlLabels: '播放 / 暂停的全局快捷键' }], '全局 暂停')).toHaveLength(1)
    expect(searchSettings([transparency], '   ')).toEqual([])
    expect(searchSettings([transparency], '不存在的设置')).toEqual([])
  })

  it('只高亮字面关键词，正则字符和 HTML 文本不会变成表达式或标签', () => {
    expect(settingsMatchParts('玻璃背景模糊', '玻璃 模糊')).toEqual([
      { text: '玻璃', match: true }, { text: '背景', match: false }, { text: '模糊', match: true },
    ])
    expect(settingsMatchParts('A+B 与 AAB', 'a+b')).toEqual([
      { text: 'A+B', match: true }, { text: ' 与 AAB', match: false },
    ])
    expect(settingsMatchParts('<img src=x>', '<img')[0]).toEqual({ text: '<img', match: true })
  })

  it('单个关键词没有完整命中时，按序出现在名称里的字也能找到，排在完整命中之后', () => {
    const size = entry('桌面歌词字号', '', '歌词', '桌面歌词')
    const other = entry('字号', '桌面显示的大小')
    expect(searchSettings([size, other], '桌面字号')).toEqual([size])
    expect(searchSettings([size, entry('桌面字号调节')], '桌面字号')[0].label).toBe('桌面字号调节')
    expect(searchSettings([size], '号字')).toEqual([])
    expect(searchSettings([size], '桌面 号字')).toEqual([])
  })

  it('同档结果里分类名命中的排前', () => {
    const elsewhere = entry('加宽后显示歌词', '', '界面与窗口', '迷你播放条')
    const own = entry('歌词字体', '', '歌词与特效', '歌词页')
    expect(searchSettings([elsewhere, own], '歌词')).toEqual([own, elsewhere])
  })

  it('结果按分类聚合，分类顺序跟随最相关的一项', () => {
    const a = { ...entry('甲', '', '播放'), section: 'play' }
    const b = { ...entry('乙', '', '界面'), section: 'visual' }
    const c = { ...entry('丙', '', '播放'), section: 'play' }
    expect(groupSettingsResults([b, a, c]).map(group => [group.label, group.items])).toEqual([['界面', [b]], ['播放', [a, c]]])
  })
})
