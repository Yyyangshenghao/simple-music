import { session } from 'electron'
import { electronProxyRules, type ProxySettings } from '../../server/lib/proxy-config'

const APPLE_PARTITION = 'persist:simplemusic-apple-music'
// setProxy 只在单个会话上生效，不会从 defaultSession 继承；登录窗口与播放宿主各有独立分区。
const SHARED_PARTITIONS = [
  'persist:simplemusic-netease-login',
  'persist:simplemusic-qqmusic-login',
  'persist:simplemusic-playback-v1',
]

/**
 * 把代理规则同步到主窗口、登录窗口与 Apple Music 分区。
 * Apple Music 用独立出口：海外账号在国内节点下会被带回国内，触发地区与风控问题。
 */
export function applySessionProxy(settings: ProxySettings): Promise<void> {
  const base = electronProxyRules(settings)
  const apple = electronProxyRules(settings, 'apple')
  const pending = [session.defaultSession.setProxy(base)]
  for (const partition of SHARED_PARTITIONS) pending.push(session.fromPartition(partition).setProxy(base))
  pending.push(session.fromPartition(APPLE_PARTITION).setProxy(apple))
  return Promise.all(pending).then(() => {})
}
