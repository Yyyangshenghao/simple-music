import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settings'
import { useShortcutStore } from '../../stores/shortcuts'
import {
  SHORTCUT_ACTIONS, acceleratorFromEvent, bindingConflict, formatAccelerator,
  isSafeGlobalAccelerator, isSystemReservedAccelerator, normalizeAccelerator, type ShortcutScope
} from '../../lib/shortcuts'
import { Switch } from '../ui/Switch'
import styles from './ShortcutSettings.module.css'

type Editing = { action: string; scope: ShortcutScope }

export function ShortcutSettings() {
  const local = useSettingsStore((s) => s.localHotkeys)
  const global = useSettingsStore((s) => s.hotkeys)
  const globalEnabled = useSettingsStore((s) => s.globalHotkeysEnabled)
  const mediaEnabled = useSettingsStore((s) => s.mediaKeysEnabled)
  const pending = useShortcutStore((s) => s.pending)
  const results = useShortcutStore((s) => s.results)
  const registrationError = useShortcutStore((s) => s.error)
  const menuAccelerators = useShortcutStore((s) => s.menuAccelerators)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<{ action: string; scope: ShortcutScope; message: string } | null>(null)
  const platform = window.desktop?.platform ?? 'win32'

  useEffect(() => () => useShortcutStore.getState().setRecording(false), [])

  const finish = () => {
    setEditing(null)
    useShortcutStore.getState().setRecording(false)
  }
  const save = (action: string, scope: ShortcutScope, accelerator: string) => {
    const settings = useSettingsStore.getState()
    const bindings = scope === 'local' ? settings.localHotkeys : settings.hotkeys
    const next = [...bindings.filter((item) => item.action !== action), { action, accelerator }]
    if (scope === 'local') settings.setLocalHotkeys(next)
    else settings.setHotkeys(next)
    setError(null)
    finish()
  }

  return (
    <div className={styles.panel}>
      <div className={styles.intro}>
        <h3>让常用操作触手可及</h3>
        <p>点击按键后按下新组合。Esc 取消，Delete 或 Backspace 清除。</p>
      </div>
      <table className={styles.table}>
        <thead><tr><th scope="col">功能</th><th scope="col">应用内快捷键</th><th scope="col">全局快捷键</th></tr></thead>
        <tbody>
          {SHORTCUT_ACTIONS.map(({ id, label }) => (
            <tr key={id}>
              <th scope="row">{label}</th>
              {(['local', 'global'] as const).map((scope) => {
                const accelerator = (scope === 'local' ? local : global).find((item) => item.action === id)?.accelerator ?? ''
                const active = editing?.action === id && editing.scope === scope
                const ownError = error?.action === id && error.scope === scope ? error.message : ''
                const failed = scope === 'global' && globalEnabled && !editing && results.find((item) => (
                  !item.ok && item.action === id && normalizeAccelerator(item.accelerator, platform) === normalizeAccelerator(accelerator, platform)
                ))
                const systemReserved = !!accelerator && isSystemReservedAccelerator(accelerator, platform)
                const message = ownError || (systemReserved ? '该组合键为常见系统快捷键，请选择其他按键'
                  : failed ? failed.conflict?.reason ?? '组合键不可用' : '')
                const fieldLabel = `${label}的${scope === 'local' ? '应用内' : '全局'}快捷键`
                return (
                  <td key={scope}>
                    <div className={styles.binding} data-shortcut-recorder>
                      <button
                        type="button"
                        className={`${styles.key} no-drag ${active ? styles.recording : ''} ${message ? styles.invalid : ''}`}
                        aria-label={fieldLabel}
                        aria-describedby={message ? `shortcut-error-${id}-${scope}` : undefined}
                        aria-pressed={active}
                        title={scope === 'global' && !globalEnabled ? '全局快捷键已停用，仍可修改绑定' : '点击修改快捷键'}
                        onClick={() => {
                          setError(null)
                          setEditing({ action: id, scope })
                          useShortcutStore.getState().setRecording(true)
                        }}
                        onBlur={() => { if (active) finish() }}
                        onKeyDown={(event) => {
                          if (!active) return
                          event.preventDefault()
                          event.stopPropagation()
                          if (event.key === 'Escape') {
                            finish()
                            return
                          }
                          if (pending || event.repeat || event.nativeEvent.isComposing) return
                          if (event.key === 'Backspace' || event.key === 'Delete') {
                            save(id, scope, '')
                            return
                          }
                          const next = acceleratorFromEvent(event.nativeEvent, platform)
                          if (!next) return
                          if (isSystemReservedAccelerator(next, platform)) {
                            setError({ action: id, scope, message: '该组合键为常见系统快捷键，请选择其他按键' })
                            return
                          }
                          const ownSettingsMenu = scope === 'local' && id === 'settings'
                            && normalizeAccelerator(accelerator, platform) === next
                          if (menuAccelerators.includes(next) && !ownSettingsMenu) {
                            setError({ action: id, scope, message: '该组合键用于应用菜单，请选择其他按键' })
                            return
                          }
                          const conflict = bindingConflict(id, next, local, global, platform)
                          if (conflict || (scope === 'global' && !isSafeGlobalAccelerator(next))) {
                            setError({ action: id, scope, message: conflict ? `已用于「${conflict}」` : '全局快捷键需包含修饰键，或使用 F1–F24' })
                            return
                          }
                          save(id, scope, next)
                        }}
                      >
                        {active ? (pending ? '准备录入…' : '请按下组合键…') : formatAccelerator(accelerator, platform)}
                      </button>
                      {!!accelerator && !active && <button
                        type="button" className={`${styles.clear} no-drag`} aria-label={`清除${fieldLabel}`}
                        onClick={() => save(id, scope, '')}
                      >×</button>}
                    </div>
                    {message && <p className={styles.error} id={`shortcut-error-${id}-${scope}`} role="alert">{message}</p>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.options}>
        <div className={styles.option}>
          <div><strong>启用全局快捷键</strong><p>应用在后台时也能响应；组合键被占用时会在上方提示。</p></div>
          <Switch checked={globalEnabled} onChange={(v) => useSettingsStore.getState().setGlobalHotkeysEnabled(v)} aria-label="启用全局快捷键" />
        </div>
        <div className={styles.option}>
          <div><strong>使用系统媒体快捷键</strong><p>控制网易云、QQ 与本地播放的播放、暂停、切歌与停止。Apple Music 的媒体键由官网会话独立管理。</p></div>
          <Switch checked={mediaEnabled} onChange={(v) => useSettingsStore.getState().setMediaKeysEnabled(v)} aria-label="使用系统媒体快捷键" />
        </div>
        <div className={styles.footer}>
          <p role="status">{registrationError || (editing ? '录入期间全局快捷键暂停响应' : pending ? '正在应用快捷键…' : '修改后立即生效，重启后保留。输入文字时不会触发应用内快捷键。')}</p>
          <button type="button" className={`${styles.reset} no-drag`} onClick={() => {
            finish()
            setError(null)
            useSettingsStore.getState().resetShortcuts()
          }}>恢复默认</button>
        </div>
      </div>
    </div>
  )
}
