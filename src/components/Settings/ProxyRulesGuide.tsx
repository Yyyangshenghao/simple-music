import { useId, useState, type RefObject } from 'react'
import { PROXY_CLIENTS, desktopPlatform, proxyDnsSnippet, proxyRuleSnippet, type ProxyClient, type RuleScope } from '../../lib/proxy-rules'
import help from './PlaybackLogicHelp.module.css'
import styles from './ProxyRulesGuide.module.css'

const SCOPES: { scope: RuleScope; title: string; caption: string }[] = [
  { scope: 'apple', title: '推荐：只让 Apple Music 直连', caption: '只影响 Apple 的域名，其他流量仍按你原来的规则走。' },
  { scope: 'app', title: '或者：整个应用直连', caption: '按进程名匹配，网易云与 QQ 音乐也会直连；需要代理软件支持进程规则。' },
]

function RuleBlock({ text, title, caption }: { text: string; title: string; caption: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* 剪贴板不可用时用户仍可手动选中复制 */ }
  }

  return (
    <section className={styles.block}>
      <div className={styles.blockHeading}>
        <div>
          <h3>{title}</h3>
          <p className={help.caption}>{caption}</p>
        </div>
        {/* 「已复制」与「复制」同宽，切换时按钮不挤动。 */}
        <button type="button" className={`${styles.copy} no-drag`} onClick={() => void copy()} aria-label={`复制${title}`}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className={styles.code}>{text}</pre>
    </section>
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
          <div className={help.body}>
            <p className={styles.lead}>TUN 在系统层接管全部流量，应用里选“直连”也绕不开。把下面的规则加进代理软件，改好后回到这里点“检测连接”，Apple 判定地区回到账号地区即生效。</p>
            <div className={styles.clients} role="group" aria-label="代理软件">
              {PROXY_CLIENTS.map((item) => (
                <button key={item.id} type="button" aria-pressed={client === item.id}
                  className={`${styles.client} no-drag${client === item.id ? ` ${styles.clientActive}` : ''}`}
                  onClick={() => setClient(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className={help.caption}>{current.where}</p>
            {SCOPES.map((item) => <RuleBlock key={item.scope} text={proxyRuleSnippet(client, item.scope, desktopPlatform())} title={item.title} caption={item.caption} />)}
            {/* 直连规则只管出口；DNS 仍走海外时会解析到海外节点，直连过去登录慢、播放超时。 */}
            <RuleBlock text={proxyDnsSnippet(client)} title="同时：Apple 域名用国内 DNS"
              caption={`直连后登录很慢或播放超时，多半是 DNS 解析到了海外节点。${current.dnsWhere}`} />
          </div>
        </div>
      </dialog>
    </>
  )
}
