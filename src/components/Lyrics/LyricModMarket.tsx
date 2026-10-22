import { useEffect, useState } from 'react'
import { useLyricModsStore } from '../../stores/lyric-mods'
import type { LyricMod } from '../../types/folium'
import styles from './LyricModMarket.module.css'

export function LyricModMarket({ previewId, onPreview, onUse, onClose }: {
  previewId: string | null
  onPreview(id: string | null): void
  onUse(id: string): void
  onClose(): void
}) {
  const state = useLyricModsStore()
  const [tab, setTab] = useState<'compatible' | 'installed' | 'all'>('compatible')
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  useEffect(() => {
    void state.refreshInstalled()
    void state.refreshCatalog()
  }, [])
  const installed = new Map(state.installed.map(mod => [mod.id, mod]))
  const items: LyricMod[] = tab === 'installed' ? state.installed
    : state.catalog.filter(mod => tab === 'all' || mod.compatible)
  const filtered = items.filter(mod => (mod.name + ' ' + mod.author).toLowerCase().includes(query.trim().toLowerCase()))
  const currentId = previewId ?? state.selectedId
  const schema = currentId ? state.schemas[currentId] ?? [] : []
  const values = currentId ? state.values[currentId] ?? {} : {}
  return <aside className={styles.panel + ' no-drag'} aria-label="歌词模组市场">
    <div className={styles.header}>
      <div><h2>歌词模组</h2><span>来自 Folium 市场</span></div>
      <button className={styles.close} aria-label="关闭模组市场" onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </div>
    {previewId && <div className={styles.previewBar}>
      <span>正在试用：{installed.get(previewId)?.name ?? previewId}</span>
      <div><button onClick={() => onPreview(null)}>结束试用</button><button className={styles.primary} onClick={() => onUse(previewId)}>使用</button></div>
    </div>}
    <div className={styles.tools}>
      <div className={styles.tabs} role="tablist" aria-label="模组范围">
        {([['compatible', '可用'], ['installed', '已安装'], ['all', '全部']] as const).map(([key, name]) =>
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? styles.selected : ''} onClick={() => setTab(key)}>{name}</button>)}
      </div>
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模组" aria-label="搜索模组" />
    </div>
    {state.error && <div className={styles.error} role="status"><span>{state.error}</span>
      <button onClick={() => { void state.refreshInstalled(); void state.refreshCatalog() }}>重试</button></div>}
    <div className={styles.content}>
      {tab === 'all' && <p className={styles.scope}>目前支持已验证的歌词动画，其他类型会显示适配原因。</p>}
      {state.loading && !items.length && tab !== 'installed' ? <div className={styles.grid} aria-label="正在加载模组"><div className={styles.skeleton} /><div className={styles.skeleton} /></div>
        : filtered.length ? <div className={styles.grid}>{filtered.map(mod => {
          const local = installed.get(mod.id)
          const usable = !!local?.valid
          const update = usable && local.digest !== mod.digest && mod.compatible
          return <article key={mod.id} className={styles.card} data-mod-card={mod.id}>
            {mod.preview ? <img src={mod.preview} className={styles.image} alt={mod.name + '效果截图'} loading="lazy" referrerPolicy="no-referrer" />
              : <div className={styles.image + ' ' + styles.noImage}>已安装样式</div>}
            <div className={styles.cardBody}>
              <div className={styles.title}><h3 title={mod.name}>{mod.name}</h3>
                {state.selectedId === mod.id && usable && <span>使用中</span>}</div>
              <p className={styles.author} title={mod.author}>{mod.author || '未署名'} · {mod.version || '版本未知'}</p>
              <p className={styles.description} title={mod.description}>{mod.description}</p>
              {/* 已安装但文件异常时只说明本地原因，不再重复市场的兼容原因。 */}
              {local && !local.valid ? <p className={styles.reason}>{local.reason}</p>
                : !mod.compatible && <p className={styles.reason}>{mod.reason}</p>}
              {removing === mod.id ? <div className={styles.confirm}>
                <span>移除样式及其设置？</span><div>
                  <button disabled={!!state.busy} onClick={() => { void state.remove(mod.id).then(() => { if (previewId === mod.id) onPreview(null); setRemoving(null) }) }}>卸载</button>
                  <button disabled={!!state.busy} onClick={() => setRemoving(null)}>取消</button>
                </div>
              </div> : <div className={styles.actions}>
                {usable ? <>
                  <button disabled={!!state.busy} onClick={() => onPreview(mod.id)}>试用</button>
                  <button className={styles.primary} disabled={!!state.busy} onClick={() => onUse(mod.id)}>使用</button>
                  {update && <button disabled={!!state.busy} onClick={() => { void state.install(mod.id) }}>更新</button>}
                </> : <button className={styles.primary} disabled={!mod.compatible || !!state.busy || !!local}
                  onClick={() => { void state.install(mod.id) }}>{state.busy === mod.id ? '安装中…' : local ? '文件异常' : mod.compatible ? '安装' : '暂不可用'}</button>}
                {local && <button className={styles.remove} disabled={!!state.busy} onClick={() => setRemoving(mod.id)}>卸载</button>}
              </div>}
            </div>
          </article>
        })}</div> : <div className={styles.empty}>{query ? '没有匹配的模组' : tab === 'installed' ? '还没有安装模组' : '暂时没有可显示的模组'}
          {tab === 'installed' && !query && <button onClick={() => setTab('compatible')}>浏览可用样式</button>}</div>}
      {!!schema.length && currentId && <details className={styles.settings}>
        <summary>调整当前样式</summary>
        {schema.map(field => <label key={field.key} className={styles.setting}>
          <span>{field.label}</span>
          {field.type === 'number' ? <><input type="range" min={field.min ?? 0} max={field.max ?? 2} step={field.step ?? 0.05}
            value={Number(values[field.key] ?? field.defaultValue)} onChange={event => state.setValues(currentId, { [field.key]: Number(event.target.value) })} />
            <output>{Number(values[field.key] ?? field.defaultValue).toFixed(2)}</output></>
            : field.type === 'boolean' ? <input type="checkbox" checked={Boolean(values[field.key] ?? field.defaultValue)} onChange={event => state.setValues(currentId, { [field.key]: event.target.checked })} />
              : <select value={String(values[field.key] ?? field.defaultValue)} onChange={event => state.setValues(currentId, { [field.key]: event.target.value })}>
                {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
        </label>)}
      </details>}
    </div>
    <footer className={styles.footer}>内置跃字始终可用，安装不会改变当前样式。</footer>
  </aside>
}
