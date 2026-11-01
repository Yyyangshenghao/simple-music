import { useEffect, useRef, useState } from 'react'
import { InfoButton } from '../ui/InfoButton'
import { appleRegionLabel } from '../../lib/apple-music-regions'
import { ProxyRulesGuide } from './ProxyRulesGuide'
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
  saveProxySettings,
  sameProxySettings,
  type ProxyCandidate,
  type DiagnosisFinding,
  type ProxyCheckId,
  type ProxyDiagnosis,
  type ProxySettings,
  type SystemProxyInfo,
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
const PLATFORM_ORDER: Exclude<ProxyCheckId, 'egress'>[] = ['netease', 'qq', 'apple']
const INFO_TEXT = '跟随系统：使用系统代理设置。自定义：填代理软件的 HTTP 或 SOCKS5 端口。Apple Music 可以单独选出口。代理软件开着 TUN 时，“直连”也会被它接管，可按“代理软件规则”让 Apple 直连。'

type Busy = 'save' | 'diagnose' | 'detect' | null

interface ResultRow {
  key: string
  label: string
  /** 只在与默认线路不同时显示（Apple 单独出口），避免每行重复同一条线路。 */
  route: string
  message: string
  state: 'idle' | 'ok' | 'slow' | 'failed'
}

/**
 * 结果固定四行：首行是默认线路与出口（线路只写一次），其后三个平台只给可达性；
 * Apple 行附带 Apple 判定的地区，单独出口时才显示自己的线路。
 */
function resultRows(diagnosis: ProxyDiagnosis | null): ResultRow[] {
  const main = diagnosis?.routes.find((route) => route.target === 'default')
  const egress = main?.checks.find((check) => check.id === 'egress')
  const rows: ResultRow[] = [{
    key: 'route',
    label: '线路',
    route: main ? proxyRouteLabel(main, diagnosis?.systemTakeover) : '',
    message: egress ? proxyCheckMessage(egress) : '尚未检测',
    state: !egress ? 'idle' : egress.ok ? 'ok' : 'failed',
  }]
  for (const id of PLATFORM_ORDER) {
    const route = diagnosis?.routes.find((item) => item.checks.some((check) => check.id === id))
    const check = route?.checks.find((item) => item.id === id)
    if (!route || !check) {
      rows.push({ key: id, label: PROXY_CHECK_LABELS[id], route: '', message: '尚未检测', state: 'idle' })
      continue
    }
    const separate = route.target === 'apple'
    const region = check.appleRegion ? `Apple 判定${appleRegionLabel(check.appleRegion)}` : ''
    const message = proxyCheckMessage(check)
    rows.push({
      key: id,
      label: PROXY_CHECK_LABELS[id],
      route: separate ? proxyRouteLabel(route) : '',
      message: check.ok && region ? `${message} · ${region}` : message,
      state: !check.ok ? 'failed' : check.slow ? 'slow' : 'ok',
    })
  }
  return rows
}

const FINDING_ACTIONS: Record<NonNullable<DiagnosisFinding['action']>, string> = {
  'proxy-rules': '让 Apple 直连',
  'apple-direct': 'Apple 改为直连',
  'detect-proxy': '自动检测代理',
}

function addressPlaceholder(mode: ProxySettings['mode'], systemProxy: SystemProxyInfo | null): string {
  if (mode === 'direct') return '直连不经过代理'
  if (mode === 'system') {
    if (!systemProxy) return '正在读取系统代理…'
    // PAC/分流：国内直连、Apple 走代理，地址框里直接说清楚两边。
    return systemProxy.apple ? `国内平台直连，Apple 走 ${systemProxy.apple}` : '系统未设置代理'
  }
  return '127.0.0.1:7890'
}

export function ProxySettings() {
  const [proxy, setProxy] = useState<ProxySettings>(DEFAULT_PROXY_SETTINGS)
  const [saved, setSaved] = useState<ProxySettings>(DEFAULT_PROXY_SETTINGS)
  const [systemProxy, setSystemProxy] = useState<SystemProxyInfo | null>(null)
  const [candidates, setCandidates] = useState<ProxyCandidate[]>([])
  const [diagnosis, setDiagnosis] = useState<ProxyDiagnosis | null>(null)
  // 改了设置后旧结果仍保留但变淡：清空会让结论区忽有忽无，面板跟着跳。
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState('')
  // 编辑或再次检测时递增；在途诊断返回时会话已变就丢弃，避免旧结果盖住新设置。
  const session = useRef(0)
  const mounted = useRef(true)
  const rulesDialog = useRef<HTMLDialogElement>(null)
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
      const info = await loadSystemProxy()
      if (mounted.current) setSystemProxy(info)
    } catch {
      if (mounted.current) setSystemProxy({ address: '', apple: '' })
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
      setSystemProxy({ address: result.systemProxy, apple: result.systemProxyApple ?? result.systemProxy })
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
  const rows = resultRows(diagnosis)
  const problems = diagnosis?.findings.filter((finding) => finding.level === 'problem') ?? []
  const notices = diagnosis?.findings.filter((finding) => finding.level === 'notice') ?? []

  function runAction(action: NonNullable<DiagnosisFinding['action']>): void {
    if (action === 'proxy-rules') rulesDialog.current?.showModal()
    else if (action === 'detect-proxy') void handleDetect()
    else {
      updateProxy({ apple: 'direct' })
      setStatus('已改为 Apple Music 直连，保存后生效')
    }
  }

  return (
    <section id="settings-detail-proxy" className={`${page.group} ${page.storageShared}`}>
      <h3 className={page.groupTitle}>
        代理
        <span className={styles.titleActions}>
          <ProxyRulesGuide dialogRef={rulesDialog} />
          <InfoButton label="代理" text={INFO_TEXT} />
        </span>
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
            value={proxy.mode === 'custom' ? proxy.url : proxy.mode === 'system' ? systemProxy?.address ?? '' : ''}
            title={proxy.mode === 'system' && systemProxy?.address ? `系统当前代理：${systemProxy.address}` : undefined}
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
      {/* 主次：需要处理的问题放最前、带解决按钮；结果只列事实；提示一行小字垫底。 */}
      {problems.length > 0 && (
        <div className={styles.problems} data-stale={faded || undefined}>
          {problems.map((finding, index) => (
            // 两条线路可能给出同名问题（例如都连不上代理），key 带上序号与原因。
            <div key={`${index}-${finding.title}-${finding.detail ?? ''}`} className={styles.problem} role="alert">
              <div className={styles.problemText}>
                <strong>{finding.title}</strong>
                {finding.detail && <span>{finding.detail}</span>}
              </div>
              {finding.action && (
                <button type="button" className={`${page.storageAction} ${page.actionPrimary} no-drag`} disabled={busy !== null}
                  onClick={() => runAction(finding.action!)}>
                  {FINDING_ACTIONS[finding.action]}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ul className={styles.checks} aria-label="连接检测结果" aria-busy={busy === 'diagnose'} data-stale={faded || undefined}>
        {rows.map((row) => {
          const message = busy === 'diagnose' ? '检测中…' : row.message
          return (
            <li key={row.key} className={styles.check} data-state={busy === 'diagnose' ? 'running' : row.state}>
              <span className={styles.checkLabel}>{row.label}</span>
              <span className={styles.checkRoute} title={row.route || undefined}>{row.route}</span>
              <span className={styles.checkResult} title={message}>{message}</span>
            </li>
          )
        })}
      </ul>
      {notices.length > 0 && (
        <ul className={styles.notices} aria-label="检测提示" data-stale={faded || undefined}>
          {notices.map((finding, index) => (
            <li key={`${index}-${finding.title}`}>{finding.title}{finding.detail && <span>，{finding.detail}</span>}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
