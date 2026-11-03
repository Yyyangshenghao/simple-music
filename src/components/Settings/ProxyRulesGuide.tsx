import { useId, useState, type RefObject } from 'react'
import { PROXY_CLIENTS, desktopPlatform, proxyDnsSnippet, proxyRuleSnippet, type ProxyClient, type RuleScope } from '../../lib/proxy-rules'
import help from './PlaybackLogicHelp.module.css'
import styles from './ProxyRulesGuide.module.css'

const SCOPES: { scope: RuleScope; title: string; note?: string; recommended?: boolean }[] = [
  { scope: 'apple', title: '只让 Apple Music 直连', recommended: true },
  { scope: 'app', title: '整个应用直连', note: '网易云、QQ 音乐也会直连，需支持进程规则' },
]

function CodeBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* 剪贴板不可用时用户仍可手动选中复制 */ }
  }

  return (
    <div className={styles.codeWrap}>
      <pre className={styles.code}>{text}</pre>
      <button type="button" className={`${styles.copy} no-drag`} onClick={() => void copy()}
        aria-label={copied ? `已复制${label}` : `复制${label}`} title={copied ? '已复制' : '复制'}>
        {copied
          ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          : <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></svg>}
      </button>
    </div>
  )
}

/** 代理软件规则引导：TUN/增强模式下应用绕不开代理，只能请用户在代理软件里让 Apple Music 直连。 */
export function ProxyRulesGuide({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement> }) {
  const dialogId = useId()
  const titleId = useId()
  const [client, setClient] = useState<ProxyClient>('clash')
  const current = PROXY_CLIENTS.find((item) => item.id === client)!

  return (
    <>
      <button type="button" className={`${help.trigger} no-drag`} aria-haspopup="dialog" aria-controls={dialogId}
        onClick={() => dialogRef.current?.showModal()}>
        <span aria-hidden="true">?</span>代理软件规则
      </button>
      <dialog ref={dialogRef} id={dialogId} className={help.dialog} aria-labelledby={titleId}
        onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}>
        <div className={help.content}>
          <header className={help.header}>
            <div>
              <span className={help.eyebrow}>代理软件开着 TUN / 增强模式时</span>
              <h2 id={titleId}>让 Apple Music 直连</h2>
            </div>
            <button type="button" className={help.close} aria-label="关闭代理软件规则" onClick={() => dialogRef.current?.close()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <div className={`${help.body} ${styles.body}`}>
            <p className={styles.lead}>TUN 接管全部流量，应用里的“直连”不起作用。把规则加进代理软件，再点“检测连接”确认。</p>
            <div className={styles.clients} role="group" aria-label="代理软件">
              {PROXY_CLIENTS.map((item) => (
                <button key={item.id} type="button" aria-pressed={client === item.id}
                  className={`${styles.client} no-drag${client === item.id ? ` ${styles.clientActive}` : ''}`}
                  onClick={() => setClient(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <section className={styles.step}>
              <h3><span className={styles.stepNo}>1</span>直连规则</h3>
              <p className={styles.where}>{current.where}</p>
              {SCOPES.map((item) => (
                <div key={item.scope} className={styles.option}>
                  <h4>
                    {item.title}
                    {item.recommended && <span className={styles.recommended}>推荐</span>}
                    {item.note && <span className={styles.note}>{item.note}</span>}
                  </h4>
                  <CodeBlock text={proxyRuleSnippet(client, item.scope, desktopPlatform())} label={item.title} />
                </div>
              ))}
            </section>
            {/* 直连规则只管出口；DNS 仍走海外时会解析到海外节点，直连过去登录慢、播放超时。 */}
            <section className={styles.step}>
              <h3><span className={styles.stepNo}>2</span>Apple 域名用国内 DNS</h3>
              <p className={styles.where}>{current.dnsWhere}不加可能登录慢、播放超时。</p>
              <CodeBlock text={proxyDnsSnippet(client)} label="DNS 配置" />
            </section>
          </div>
        </div>
      </dialog>
    </>
  )
}
