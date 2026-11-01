import { useEffect, useRef, useState } from 'react'
import { InfoButton } from '../ui/InfoButton'
import {
  DEFAULT_PROXY_SETTINGS,
  PROXY_CHECK_LABELS,
  detectProxyCandidates,
  diagnoseProxySettings,
  loadProxySettings,
  loadSystemProxy,
  proxyCheckMessage,
  proxyDiagnosisSummary,
  proxyRouteLabel,
  regionLabel,
  saveProxySettings,
  sameProxySettings,
  type ProxyCandidate,
  type ProxyCheck,
  type ProxyCheckId,
  type ProxyDiagnosis,
  type ProxySettings,
} from '../../lib/network-settings'
import page from '../../pages/SettingsPage.module.css'
import styles from './ProxySettings.module.css'

const PROXY_MODE_OPTIONS: { value: ProxySettings['mode']; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'custom', label: '自定义' },
  { value: 'direct', label: '直连' },
]
const APPLE_PROXY_OPTIONS: { value: ProxySettings['apple']; label: string }[] = [
  { value: 'inherit', label: '跟随默认' },
  { value: 'custom', label: '单独代理' },
  { value: 'direct', label: '直连' },
]
const CHECK_ORDER: ProxyCheckId[] = ['netease', 'qq', 'apple', 'egress']
const INFO_TEXT = '跟随系统：使用系统设置里的代理，代理软件开启“系统代理”后，登录窗口与搜索、曲库、播放一起生效。自定义：填写代理软件的 HTTP 或 SOCKS5 端口，例如 127.0.0.1:7890，也可以自动检测本机代理。Apple Music 可以单独选出口，避免国内节点把海外账号带回国内地区。代理软件开着 TUN/增强模式时，它在系统层接管全部流量，这里选直连也会经过代理节点，检测会标出来。'

type Busy = 'save' | 'diagnose' | 'detect' | null

interface CheckRow {
  id: ProxyCheckId
  route: string
  /** 未检测时为 null。 */
  check: ProxyCheck | null
  /** Apple 单独出口时，Apple 行附带该线路的出口地区。 */
  region: string
}

/**
 * 把诊断结果摊成固定四行。每行只对应一条线路：出口地区行显示默认出口，
 * Apple 单独出口时它的出口地区并入 Apple Music 行，避免一行塞两条线路被截断。
 */
function checkRows(diagnosis: ProxyDiagnosis | null): CheckRow[] {
  return CHECK_ORDER.map((id) => {
    const route = diagnosis?.routes.find((item) => item.checks.some((check) => check.id === id) && (id !== 'egress' || item.target === 'default'))
    const check = route?.checks.find((item) => item.id === id) ?? null
    if (!route || !check) return { id, route: '', check: null, region: '' }
    const egress = route.target === 'apple' && id === 'apple' ? route.checks.find((item) => item.id === 'egress') : undefined
    const region = egress?.ok ? regionLabel(egress.country) : ''
    return { id, route: proxyRouteLabel(route, diagnosis?.systemTakeover), check, region }
  })
}

function rowMessage(row: CheckRow): string {
  if (!row.check) return ''
  const message = proxyCheckMessage(row.check)
  return row.check.ok && row.region ? `${message} · 出口${row.region}` : message
}

function addressPlaceholder(mode: ProxySettings['mode'], systemProxy: string | null): string {
  if (mode === 'direct') return '直连不经过代理'
  if (mode === 'system') return systemProxy === null ? '正在读取系统代理…' : '系统未设置代理'
  return '127.0.0.1:7890'
}

export function ProxySettings() {
  const [proxy, setProxy] = useState<ProxySettings>(DEFAULT_PROXY_SETTINGS)
  const [saved, setSaved] = useState<ProxySettings>(DEFAULT_PROXY_SETTINGS)
  const [systemProxy, setSystemProxy] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<ProxyCandidate[]>([])
  const [diagnosis, setDiagnosis] = useState<ProxyDiagnosis | null>(null)
  // 改了设置后旧结果仍保留但变淡：清空会让结论区忽有忽无，面板跟着跳。
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState('')
  // 编辑或再次检测时递增；在途诊断返回时会话已变就丢弃，避免旧结果盖住新设置。
  const session = useRef(0)
  const mounted = useRef(true)
  const dirty = !sameProxySettings(proxy, saved)
  const missingAddress = (proxy.mode === 'custom' && !proxy.url.trim()) || (proxy.apple === 'custom' && !proxy.appleUrl.trim())

  useEffect(() => {
    mounted.current = true
    void loadProxySettings().then((settings) => {
      if (!mounted.current) return
      setProxy(settings)
      setSaved(settings)
    }).catch(() => { if (mounted.current) setStatus('无法读取代理设置，请重试') })
    void refreshSystemProxy()
    return () => { mounted.current = false }
  }, [])

  async function refreshSystemProxy(): Promise<void> {
    try {
      const address = await loadSystemProxy()
      if (mounted.current) setSystemProxy(address)
    } catch {
      if (mounted.current) setSystemProxy('')
    }
  }

  function updateProxy(patch: Partial<ProxySettings>): void {
    session.current++
    setProxy((current) => ({ ...current, ...patch }))
    setStale(true)
    setStatus('')
    if (patch.mode === 'system') void refreshSystemProxy()
  }

  async function runDiagnosis(settings: ProxySettings, prefix = ''): Promise<void> {
    const id = ++session.current
    setBusy('diagnose')
    setStatus(`${prefix}正在检测各平台连接…`)
    try {
      const result = await diagnoseProxySettings(settings)
      if (!mounted.current || id !== session.current) return
      setDiagnosis(result)
      setStale(false)
      setSystemProxy(result.systemProxy)
      setStatus(`${prefix}${proxyDiagnosisSummary(result)}`)
    } catch (error) {
      if (mounted.current && id === session.current) setStatus(error instanceof Error ? error.message : '检测失败，请重试')
    } finally {
      // 结果可能因中途编辑被丢弃，但忙态必须复位；检测期间按钮禁用，不会有更新的检测在跑。
      if (mounted.current) setBusy(null)
    }
  }

  async function handleSave(): Promise<void> {
    setBusy('save')
    try {
      const next = await saveProxySettings(proxy)
      if (!mounted.current) return
      setProxy(next)
      setSaved(next)
      // 保存后立刻按新设置检测，让用户直接看到是否真的生效。
      await runDiagnosis(next, '已保存。')
    } catch (error) {
      if (!mounted.current) return
      setStatus(error instanceof Error ? error.message : '保存代理设置失败')
      setBusy(null)
    }
  }

  async function handleDetect(): Promise<void> {
    setBusy('detect')
    setStatus('正在检测本机代理…')
    try {
      const found = await detectProxyCandidates()
      if (!mounted.current) return
      setCandidates(found)
      if (!found.length) {
        setStatus('没有检测到本机代理，请在代理软件里查看 HTTP 或 SOCKS5 端口')
        return
      }
      session.current++
      setStale(true)
      setProxy((current) => ({ ...current, mode: 'custom', url: found[0].address }))
      const others = found.length > 1 ? `，另有 ${found.length - 1} 个可在输入框下拉中选择` : ''
      setStatus(`已填入${found[0].label}的 ${found[0].address}${others}，保存后生效`)
    } catch (error) {
      if (mounted.current) setStatus(error instanceof Error ? error.message : '检测本机代理失败')
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const statusText = status
    || (missingAddress ? '请填写代理地址'
      : diagnosis && stale ? `${dirty ? '有未保存的更改，' : '设置已更改，'}检测结果待重新检测`
      : dirty ? '有未保存的更改，保存后生效' : '可以检测当前设置下各平台能否访问')
  const faded = stale && busy !== 'diagnose'
  const rows = checkRows(diagnosis)

  return (
    <section id="settings-detail-proxy" className={`${page.group} ${page.storageShared}`}>
      <h3 className={page.groupTitle}>
        代理
        <InfoButton label="代理" text={INFO_TEXT} />
      </h3>
      <div data-setting-row className={page.row}>
        <span className={page.rowLabel}>代理模式</span>
        <div className={page.segControl} role="group" aria-label="代理模式">
          {PROXY_MODE_OPTIONS.map((option) => (
            <button key={option.value} type="button" aria-pressed={proxy.mode === option.value}
              className={`${page.seg} no-drag${proxy.mode === option.value ? ` ${page.segActive}` : ''}`}
              onClick={() => updateProxy({ mode: option.value })}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div data-setting-row className={page.row}>
        <span className={page.rowLabel}>代理地址</span>
        <div className={styles.addressControls}>
          {/* 地址行常驻：切换模式时只切换可编辑状态，布局高度不变。跟随系统时显示系统当前代理。 */}
          <input className={page.proxyInput} spellCheck={false} aria-label="代理地址" list="proxy-candidates"
            disabled={proxy.mode !== 'custom'}
            value={proxy.mode === 'custom' ? proxy.url : proxy.mode === 'system' ? systemProxy ?? '' : ''}
            title={proxy.mode === 'system' && systemProxy ? `系统当前代理：${systemProxy}` : undefined}
            placeholder={addressPlaceholder(proxy.mode, systemProxy)}
            onChange={(event) => updateProxy({ url: event.target.value })} />
          <button type="button" className={`${page.storageAction} no-drag`} disabled={busy !== null || proxy.mode !== 'custom'}
            title={proxy.mode === 'custom' ? '查找系统代理与本机常见代理端口' : '选择自定义后可自动检测'}
            onClick={() => void handleDetect()}>
            自动检测
          </button>
        </div>
      </div>
      <div data-setting-row className={page.row}>
        <span className={page.rowLabel}>Apple Music 出口</span>
        <div className={page.segControl} role="group" aria-label="Apple Music 代理">
          {APPLE_PROXY_OPTIONS.map((option) => (
            <button key={option.value} type="button" aria-pressed={proxy.apple === option.value}
              className={`${page.seg} no-drag${proxy.apple === option.value ? ` ${page.segActive}` : ''}`}
              onClick={() => updateProxy({ apple: option.value })}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div data-setting-row className={page.row}>
        <span className={page.rowLabel}>Apple Music 代理地址</span>
        <div className={styles.addressControls}>
          <input className={page.proxyInput} spellCheck={false} aria-label="Apple Music 代理地址" list="proxy-candidates"
            disabled={proxy.apple !== 'custom'}
            value={proxy.apple === 'custom' ? proxy.appleUrl : ''}
            placeholder={proxy.apple === 'custom' ? '127.0.0.1:7891' : proxy.apple === 'direct' ? '直连不经过代理' : '跟随默认出口'}
            onChange={(event) => updateProxy({ appleUrl: event.target.value })} />
        </div>
      </div>
      <datalist id="proxy-candidates">
        {candidates.map((candidate) => <option key={candidate.address} value={candidate.address} label={candidate.label} />)}
      </datalist>
      <div data-setting-row className={page.row}>
        <span className={`${page.rowLabel} ${styles.status}`} role="status" aria-live="polite" title={statusText}>{statusText}</span>
        <div className={page.rowControls}>
          <button type="button" className={`${page.storageAction} no-drag`} disabled={busy !== null || missingAddress}
            title="按当前填写的设置检测，不必先保存" onClick={() => void runDiagnosis(proxy)}>
            检测连接
          </button>
          {/* 只有可保存时才用主按钮样式：禁用的实心强调色在浅色主题下几乎看不清文字。 */}
          <button type="button" className={`${page.storageAction}${dirty && !missingAddress ? ` ${page.actionPrimary}` : ''} no-drag`} disabled={busy !== null || !dirty || missingAddress}
            onClick={() => void handleSave()}>
            保存
          </button>
        </div>
      </div>
      <ul className={styles.checks} aria-label="连接检测结果" aria-busy={busy === 'diagnose'} data-stale={faded || undefined}>
        {rows.map((row) => {
          const message = busy === 'diagnose' ? '检测中…' : row.check ? rowMessage(row) : '尚未检测'
          return (
            <li key={row.id} className={styles.check} data-state={busy === 'diagnose' ? 'running' : !row.check ? 'idle' : !row.check.ok ? 'failed' : row.check.slow ? 'slow' : 'ok'}>
              <span className={styles.checkLabel}>{PROXY_CHECK_LABELS[row.id]}</span>
              <span className={styles.checkRoute} title={row.route || undefined}>{row.route}</span>
              <span className={styles.checkResult} title={message}>{message}</span>
            </li>
          )
        })}
      </ul>
      {/* 结论逐条完整显示；只在检测后出现，改设置时变淡保留，不随切换增减。 */}
      {!!diagnosis?.hints.length && (
        <ul className={styles.hints} aria-label="检测结论" data-stale={faded || undefined}>
          {diagnosis.hints.map((hint) => <li key={hint}>{hint}</li>)}
        </ul>
      )}
    </section>
  )
}
