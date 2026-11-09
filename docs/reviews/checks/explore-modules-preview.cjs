// 仅连接独立 --user-data-dir 的 Electron dev；模拟账号/歌曲，不执行登录或播放。
// NODE_PATH 指向 Playwright，CDP_URL 与 OUTPUT_DIR 可覆盖默认值。
const {chromium}=require('playwright')
const assert=require('node:assert/strict');const fs=require('node:fs')
;(async()=>{
 const browser=await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9478');const page=browser.contexts()[0].pages().find(p=>p.url().endsWith('/index.html'))
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
 const cdp=await page.context().newCDPSession(page)
 const out=process.env.OUTPUT_DIR || 'docs/reviews/assets/2026-11-06-explore-preview';fs.mkdirSync(out,{recursive:true})
 await page.route('**/api/netease/banner',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({banners:[{track:{id:'fixture-featured',source:'netease',name:'精选示例歌曲',artist:'界面验收模拟',album:'示例专辑',duration:180000,cover:''}}]})}))
 await page.evaluate(async()=>{
  const {useProviderStore:p}=await import('/src/stores/providers.ts');const {useSettingsStore:s}=await import('/src/stores/settings.ts');const {useNavigationStore:n}=await import('/src/stores/navigation.ts');const {listProviders}=await import('/src/providers/registry.ts');const {clearProviderRequestCache}=await import('/src/lib/provider-request-cache.ts');clearProviderRequestCache()
  const {api}=await import('/src/lib/api.ts');const originalGet=api.get;api.get=(url,...args)=>url==='/api/netease/banner'?Promise.resolve({banners:[{track:{id:'fixture-featured',source:'netease',name:'精选示例歌曲',artist:'界面验收模拟',album:'示例专辑',duration:180000,cover:''}}]}):originalGet(url,...args)
  const {serviceFor}=await import('/src/lib/service-registry.ts');for(const source of ['netease','qq','kugou'])serviceFor(source).getToplists=async()=>[]
  const track={id:'fixture-weekly',source:'netease',name:'本周常听示例歌曲',artist:'界面验收模拟',album:'示例专辑',duration:180000,cover:''}
  for(const provider of listProviders()) {
   if(provider.recommendations) provider.recommendations.load=async()=>({content:{type:'playlists',playlists:[]}})
   if(provider.library) for(const key of Object.keys(provider.library)) provider.library[key]=async()=>key==='getLikedPlaylist'?null:[]
   if(provider.history) for(const key of Object.keys(provider.history)) provider.history[key]=async()=>key==='getListeningRanking'?[track]:[]
   if(provider.toplists) provider.toplists.getToplists=async()=>[]
  }
  p.setState(state=>({byId:{...state.byId,netease:{enabled:true,auth:'authenticated',profile:{nickname:'界面验收（模拟账号）',avatar:''}}}}));s.getState().setExploreLayout('netease',[]);s.getState().setPerformance({popoverSproutMotion:true,dragMotion:true});n.getState().navigateTo('settings')
 })
 await page.waitForTimeout(700)
 const gear=page.getByRole('button',{name:'网易云设置',exact:true});const panel=page.getByRole('dialog',{name:'网易云设置',exact:true});const preview=page.locator('[data-explore-preview]')
 const open=async()=>{await gear.scrollIntoViewIfNeeded();await gear.click();await panel.waitFor();await page.waitForTimeout(450)}
 const close=async()=>{if(await panel.count()){await page.keyboard.press('Escape');await panel.waitFor({state:'detached'})}}
 const bounds=[]
 for(const [width,height]of[[1536,864],[960,540]])for(const theme of['dark','light']){
  await close();await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await page.evaluate(async theme=>{const {useSettingsStore:s}=await import('/src/stores/settings.ts');s.getState().setThemeMode(theme)},theme);await open()
  await preview.locator('[aria-label="本周常听"]').waitFor({state:'attached'})
  const box=await panel.boundingBox();const pv=await preview.boundingBox();const g=await gear.boundingBox();assert.ok(pv.x>box.x&&pv.x+pv.width<=box.x+box.width);assert.ok(box.x+box.width<=g.x);assert.ok(box.y+box.height<=height);assert.ok(pv.y+pv.height<=box.y+box.height)
  assert.equal(await preview.locator('[inert]').count(),1)
  assert.ok(await preview.evaluate(el=>el.scrollHeight>=el.clientHeight))
  await page.screenshot({path:`${out}/${theme}-${width}x${height}.png`});bounds.push({viewportWidth:width,viewportHeight:height,theme,panel:box,preview:pv})
 }
 // 开关同步真实组件，关闭不会改变左侧排序。
 await panel.getByRole('switch',{name:'展示本周常听',exact:true}).click();assert.equal(await preview.locator('[aria-label="本周常听"]').count(),0)
 await panel.getByRole('switch',{name:'展示本周常听',exact:true}).click();await preview.locator('[aria-label="本周常听"]').waitFor({state:'attached'})
 // 把本周常听拖到第一位，预览DOM随稳定key重排。
 const scroll=panel.locator('[data-provider-settings-scroll]');await scroll.evaluate(el=>el.scrollTop=0)
 const rows=panel.locator('[data-reorder-row]');const weekly=rows.filter({hasText:'本周常听'});const first=rows.first();const w=await weekly.boundingBox();const f=await first.boundingBox()
 await page.mouse.move(w.x+18,w.y+w.height/2);await page.mouse.down();await page.mouse.move(f.x+18,f.y+8,{steps:15});await page.mouse.up();await page.waitForTimeout(700)
 const ids=await page.evaluate(async()=>{const{useSettingsStore:s}=await import('/src/stores/settings.ts');return s.getState().exploreLayouts.netease.map(m=>m.id)});assert.equal(ids[0],'listening')
 const sectionLabels=await preview.locator('section[aria-label]').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label')));assert.ok(sectionLabels.indexOf('本周常听')<sectionLabels.indexOf('歌曲精选'))
 // 尝试真实鼠标点击预览按钮，导航和播放保持不变。
 const before=await page.evaluate(async()=>{const {useNavigationStore:n}=await import('/src/stores/navigation.ts');const {usePlaylistStore:p}=await import('/src/stores/playlist.ts');return JSON.stringify({view:n.getState().currentView,queue:p.getState().queue})})
 const button=preview.locator('button').first();const b=await button.boundingBox();if(b&&b.y>0)await page.mouse.click(b.x+b.width/2,b.y+b.height/2)
 const after=await page.evaluate(async()=>{const {useNavigationStore:n}=await import('/src/stores/navigation.ts');const {usePlaylistStore:p}=await import('/src/stores/playlist.ts');return JSON.stringify({view:n.getState().currentView,queue:p.getState().queue})});assert.equal(before,after)
 await preview.evaluate(el=>el.scrollTop=el.scrollHeight);await panel.getByRole('button',{name:'恢复默认',exact:true}).scrollIntoViewIfNeeded();await panel.getByRole('button',{name:'恢复默认',exact:true}).click()
 await close();assert.equal(await preview.count(),0)
 // 酷狗切回游客时保持启用，预览必须重建会话且忽略旧请求。
 await page.evaluate(async()=>{
  const {providerFor}=await import('/src/providers/registry.ts');const {useProviderStore:p}=await import('/src/stores/providers.ts')
  const make=name=>({id:name,source:'kugou',provider:'kugou',type:'playlist',name,cover:'',creator:'模拟账号',trackCount:1,playCount:0})
  window.previewFixtureMake=make
  providerFor('kugou').library.getUserPlaylists=async()=>[make('旧账号的示例歌单')]
  p.setState(state=>({byId:{...state.byId,kugou:{enabled:true,auth:'authenticated',accountLinked:true,profile:{nickname:'账号A',avatar:''}}}}))
 })
 const kg=page.getByRole('button',{name:'酷狗音乐设置',exact:true});await kg.scrollIntoViewIfNeeded();await kg.click()
 await preview.getByText('旧账号的示例歌单',{exact:true}).waitFor({state:'attached'})
 await page.evaluate(async()=>{
  const {providerFor}=await import('/src/providers/registry.ts');const {useProviderStore:p}=await import('/src/stores/providers.ts')
  providerFor('kugou').library.getUserPlaylists=()=>new Promise(resolve=>{window.resolveOldPreview=resolve})
  p.getState().setAccountState('kugou','authenticated',{nickname:'账号B',avatar:''})
 })
 await page.waitForFunction(()=>typeof window.resolveOldPreview==='function')
 await page.evaluate(async()=>{
  const {providerFor}=await import('/src/providers/registry.ts');const {useProviderStore:p}=await import('/src/stores/providers.ts')
  providerFor('kugou').library.getUserPlaylists=async()=>[window.previewFixtureMake('新会话的示例歌单')]
  p.getState().setAccountState('kugou','anonymous')
 })
 await preview.getByText('新会话的示例歌单',{exact:true}).waitFor({state:'attached'})
 await page.evaluate(()=>window.resolveOldPreview([window.previewFixtureMake('过期请求的示例歌单')]))
 await page.waitForTimeout(250)
 assert.equal(await preview.getByText('过期请求的示例歌单',{exact:true}).count(),0)
 assert.equal(await preview.getByText('旧账号的示例歌单',{exact:true}).count(),0)
 await page.keyboard.press('Escape');assert.deepEqual(errors,[])
 const result={environment:'隔离macOS Electron dev，模拟账号与歌曲；未真实登录或播放',bounds,checks:['四种窗口/主题预览边界','开关同步挂载卸载实际栏目','拖动排序同步实际栏目顺序','真实鼠标点击预览不导航不播放','内部滚动','关闭面板卸载预览','启用期间账号切换重建预览，过期请求不覆盖新会话'],errors}
 fs.writeFileSync(`${out}/verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close()
})().catch(e=>{console.error(e);process.exit(1)})
