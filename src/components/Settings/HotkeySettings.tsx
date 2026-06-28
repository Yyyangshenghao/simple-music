import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settings'
import type { HotkeyBinding, HotkeyOutcome, HotkeyResult } from '../../types/ipc'
import styles from './HotkeySettings.module.css'

/** 快捷键设置：编辑 action/accelerator 草稿，应用后展示每条注册结果。 */
export function HotkeySettings() {
  const hotkeys = useSettingsStore((s) => s.hotkeys)
  const setHotkeys = useSettingsStore((s) => s.setHotkeys)

  const [draft, setDraft] = useState<HotkeyBinding[]>(hotkeys)
  const [outcomes, setOutcomes] = useState<HotkeyOutcome[]>([])

  // store 中的快捷键变更时重置草稿（外部覆盖优先）。
  useEffect(() => {
    setDraft(hotkeys)
  }, [hotkeys])

  const update = (index: number, patch: Partial<HotkeyBinding>): void => {
    setDraft((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  }

  const add = (): void => {
    setDraft((prev) => [...prev, { action: '', accelerator: '' }])
  }

  const remove = (index: number): void => {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  const apply = (): void => {
    void (async () => {
      const res = (await window.desktop?.configureHotkeys(draft)) as HotkeyResult | undefined
      if (!res) return
      setOutcomes(res.results)
      setHotkeys(draft)
    })()
  }

  const outcomeFor = (action: string): HotkeyOutcome | undefined =>
    outcomes.find((o) => o.action === action)

  return (
    <div className={styles.root}>
      <ul className={styles.list}>
        {draft.length === 0 && <li className={styles.empty}>暂无快捷键，点击下方「新增」添加。</li>}
        {draft.map((b, i) => {
          const oc = outcomeFor(b.action)
          return (
            <li key={i} className={styles.row}>
              <input
                className={styles.input}
                placeholder="动作 (如 play-pause)"
                value={b.action}
                onChange={(e) => update(i, { action: e.target.value })}
              />
              <input
                className={styles.input}
                placeholder="快捷键 (如 Ctrl+Alt+P)"
                value={b.accelerator}
                onChange={(e) => update(i, { accelerator: e.target.value })}
              />
              <span className={styles.status}>
                {oc == null ? (
                  ''
                ) : oc.ok ? (
                  <span className={styles.ok}>已生效</span>
                ) : (
                  <span className={styles.fail}>{oc.conflict ? `冲突: ${oc.conflict.reason}` : '失败'}</span>
                )}
              </span>
              <button type="button" className={styles.remove} aria-label="删除" onClick={() => remove(i)}>
                ×
              </button>
            </li>
          )
        })}
      </ul>

      <div className={styles.actions}>
        <button type="button" className={styles.add} onClick={add}>
          新增
        </button>
        <button type="button" className={styles.apply} onClick={apply}>
          应用
        </button>
      </div>
    </div>
  )
}
