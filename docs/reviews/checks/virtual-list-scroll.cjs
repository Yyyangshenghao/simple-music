// 在隔离 Electron 开发窗口运行；先启动 npm run dev -- --remote-debugging-port 9341。
// Playwright 从调用环境提供，不作为应用运行依赖安装。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9341')
  try {
    const page = browser.contexts()[0].pages().find(page => page.url().endsWith('/index.html'))
    assert.ok(page, '需要已启动的 Electron 开发主窗口')
    const result = await page.evaluate(async () => {
      const [{ default: React }, { default: { createRoot } }, { VirtualList }, { ListScrollActivity }] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'),
        import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/components/ui/VirtualList.tsx'),
        import('/src/components/ui/list-scroll-activity.ts'),
      ])
      const h = React.createElement
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111'
      document.body.append(host)
      const root = createRoot(host)
      const counts = new Map()
      let setRevision, setTotal, setRowHeight
      let playing = -1
      let lastClick = ''
      const listeners = new Set()
      const subscribe = listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
      function Row({ index, revision }) {
        const scrolling = React.useContext(ListScrollActivity)
        const current = React.useSyncExternalStore(subscribe, () => playing)
        return h('button', {
          'data-test-row': index,
          'data-scrolling': String(scrolling),
          'data-playing': String(current === index),
          onClick: () => { lastClick = `${revision}:${index}` },
        }, `${revision}:${index}`)
      }
      function App() {
        const ref = React.useRef(null)
        const [revision, updateRevision] = React.useState('old')
        const [total, updateTotal] = React.useState(5000)
        const [rowHeight, updateHeight] = React.useState(56)
        setRevision = updateRevision
        setTotal = updateTotal
        setRowHeight = updateHeight
        const renderRow = React.useCallback(index => {
          counts.set(index, (counts.get(index) || 0) + 1)
          return h(Row, { index, revision })
        }, [revision])
        return h('div', { ref, style: { height: 560, overflowY: 'auto' }, 'data-perf-scroll': '' },
          h(VirtualList, { total, rowHeight, scrollRef: ref, renderRow }))
      }
      const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const idle = async () => { await new Promise(resolve => setTimeout(resolve, 220)); await wait() }
      try {
        root.render(h(App))
        await wait()
        await wait()
        const scroll = host.querySelector('[data-perf-scroll]')
        counts.clear()
        for (let i = 1; i <= 10; i++) {
          scroll.scrollTop = i * 56
          await wait()
        }
        const active = host.querySelector('[data-test-row="10"]').dataset.scrolling
        await idle()
        const unchangedRowRenders = counts.get(10) || 0
        const stopped = host.querySelector('[data-test-row="10"]').dataset.scrolling
        playing = 10
        listeners.forEach(listener => listener())
        await wait()
        const storeUpdated = host.querySelector('[data-test-row="10"]').dataset.playing
        setRevision('new')
        await wait()
        const row = host.querySelector('[data-test-row="10"]')
        const text = row.textContent
        row.click()
        const clicked = lastClick
        scroll.scrollTop = scroll.scrollHeight
        await wait()
        await idle()
        const lastRow = !!host.querySelector('[data-test-row="4999"]')
        const mounted = host.querySelectorAll('[data-test-row]').length
        setTotal(3)
        setRowHeight(60)
        scroll.scrollTop = 0
        await wait()
        await wait()
        const shortRows = [...host.querySelectorAll('[data-test-row]')].map(row => Number(row.dataset.testRow))
        const lastShort = host.querySelector('[data-test-row="2"]').parentElement
        return { unchangedRowRenders, active, stopped, storeUpdated, text, clicked, lastRow, mounted,
          shortRows, shortTop: lastShort.style.top, shortHeight: lastShort.style.height }
      } finally {
        root.unmount()
        host.remove()
      }
    })
    console.log(JSON.stringify(result))
    assert.equal(result.unchangedRowRenders, 0, '已有可见行不应随列表滚动重建')
    assert.equal(result.active, 'true')
    assert.equal(result.stopped, 'false')
    assert.equal(result.storeUpdated, 'true', '外部播放状态应穿透行缓存更新')
    assert.equal(result.text, 'new:10', '父级数据必须更新可见内容')
    assert.equal(result.clicked, 'new:10', '点击回调必须使用最新数据')
    assert.equal(result.lastRow, true)
    assert.ok(result.mounted < 45)
    assert.deepEqual(result.shortRows, [0, 1, 2])
    assert.equal(result.shortTop, '120px')
    assert.equal(result.shortHeight, '60px')
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
