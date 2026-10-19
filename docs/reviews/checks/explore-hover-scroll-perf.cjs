// 仅用于独立 userData 的 Electron dev：本脚本替换测试实例中的平台资料、API 与图片。
// CDP_URL 指向该实例；OUTPUT_PREFIX 指定结果与 trace 的文件前缀。
const {chromium}=require('playwright')
const fs=require('node:fs')
const outputPrefix=process.env.OUTPUT_PREFIX || '/tmp/explore-hover-scroll'
;(async()=>{
 const browser=await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9347'),p=browser.contexts()[0].pages().find(p=>p.url().endsWith('/index.html'))
 await p.reload();await p.waitForLoadState('domcontentloaded')
 for(const host of browser.contexts()[0].pages().filter(page=>page.url().includes('playback-host.html'))) await host.evaluate(async()=>{const [{useProviderStore:p},{useSettingsStore:s}]=await Promise.all([import('/src/stores/providers.ts'),import('/src/stores/settings.ts')]);s.getState().setNeteaseLoggedIn(true);p.setState({byId:Object.fromEntries(['netease','qq','apple'].map(source=>[source,{enabled:true,auth:'authenticated'}])),contentSource:'netease'})})
 const icon=fs.readFileSync(require('node:path').resolve(__dirname,'../../../build/icon.png'))
 await p.route('https://covers.invalid/**',route=>route.fulfill({contentType:'image/png',body:icon}))
 await browser.contexts()[0].route('**/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({playlists:[],groups:[],songs:[],tracks:[]})}))
 await p.setViewportSize({width:1280,height:800});await p.bringToFront()
 await p.evaluate(async()=>{
  const [nav,prov,settings,cache,registry]=await Promise.all([import('/src/stores/navigation.ts'),import('/src/stores/providers.ts'),import('/src/stores/settings.ts'),import('/src/lib/provider-request-cache.ts'),import('/src/providers/registry.ts')])
  window.exploreQA={nav:nav.useNavigationStore,prov:prov.useProviderStore,settings:settings.useSettingsStore,cache}
  const q=window.exploreQA;q.settings.getState().setPerformance({bgFluidMotion:true,cardTiltEffect:true,cardSpotlightEffect:true});q.settings.getState().setThemeMode('dark')
  q.nav.getState().navigateTo('library');q.prov.setState({byId:Object.fromEntries(['netease','qq','apple'].map(s=>[s,{enabled:false,auth:'anonymous'}])),contentSource:null})
  await new Promise(r=>setTimeout(r,500));cache.clearProviderRequestCache()
  const seed=(source,scope,data)=>cache.requestProviderData(source,scope,async()=>data,{maxAgeMs:300000})
  const playlist=(source,prefix,i)=>({source,provider:source,type:'playlist',id:`${prefix}-${i}`,name:`${prefix} · ${i+1}`,cover:`https://covers.invalid/${prefix}-${i}.png`,trackCount:36,playCount:0,creator:'滚动测试'})
  for(const source of ['netease','qq','apple']){
   const items=Array.from({length:12},(_,i)=>playlist(source,'收藏',i))
   await seed(source,source==='qq'?'library:user-playlists:0':'library:user-playlists',items)
   await seed(source,'history:recent-playlists',items);await seed(source,'history:recent-tracks',[])
   if(source==='netease'){
    const service=registry.providerFor(source)
    const {serviceFor}=await import('/src/lib/service-registry.ts')
    serviceFor(source).getToplists=async()=>[{id:'test',name:'榜单',entries:Array.from({length:4},(_,i)=>({playlist:playlist(source,'榜单',i),updateFrequency:'每天更新',preview:[{name:'测试歌曲',artist:'测试艺人'}]}))}]
   }
   for(const surface of registry.providerFor(source).recommendations?.listSurfaces()||[]){
    const scope=`recommendation:${surface.id}:root${surface.id==='qq:daily'?`:${new Date(Date.now()+8*3600000).toISOString().slice(0,10)}`:''}`
    const tracks=Array.from({length:8},(_,i)=>({provider:source,source,type:'song',id:i,name:`测试歌曲${i}`,artist:'测试',artists:[],cover:`https://covers.invalid/track-${i}.png`,duration:200000}))
    const content=surface.kind==='playlist-feed'?{type:'playlists',playlists:items}:surface.kind==='private-radar'?{type:'radar',radar:null}:{type:'tracks',tracks}
    await seed(source,scope,{content})
   }
  }
  await seed('apple','recommendation:personal-groups',Array.from({length:5},(_,n)=>({id:`group-${n}`,title:['午后放松','专注时刻','为你推荐','最近常听','发现新声音'][n],items:Array.from({length:10},(_,i)=>playlist('apple',`精选${n+1}`,i))})))
  await seed('apple','charts:most-played:first',{playlists:Array.from({length:24},(_,i)=>playlist('apple','热门榜单',i)),nextCursor:'next'})
  await seed('apple','charts:storefront',Array.from({length:12},(_,i)=>playlist('apple','地区榜单',i)))
  await seed('apple','library:user-albums',[]);await seed('apple','library:liked-playlist',null)
  q.prov.setState({byId:Object.fromEntries(['netease','qq','apple'].map(s=>[s,{enabled:true,auth:'authenticated'}])),contentSource:'netease'});q.nav.getState().navigateTo('explore')
 })
 await p.getByRole('group',{name:'你的歌单',exact:true}).waitFor();await p.waitForTimeout(1600)


 const cdp=await p.context().newCDPSession(p),system=await browser.newBrowserCDPSession()
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:2,mobile:false})
 const scenarios=[{name:'blank',x:10,y:350,css:''},{name:'overCards',x:180,y:350,css:''},{name:'overCardsNoEffects',x:180,y:350,css:'.border-glow-card::before,.border-glow-card::after,.edge-light,[class*="spotlight_"]{display:none!important;} [class*="tilt_"],article{transform:none!important;box-shadow:none!important;transition:none!important;}'}]
 const results=[]
 for(const scenario of scenarios){
  const style=await p.addStyleTag({content:scenario.css||'/* base */'})
  await p.evaluate(()=>document.querySelector('[class*="greeting_"]').closest('[class*="page_"]').scrollTop=0)
  await p.mouse.move(scenario.x,scenario.y);await p.waitForTimeout(1000)
  await p.evaluate(()=>{
   const q=window.exploreQA;q.times=[];q.events={};q.writes=0;q.running=true
   q.eventHandler=e=>q.events[e.type]=(q.events[e.type]||0)+1
   for(const type of ['pointerover','pointerout','pointermove','wheel','scroll'])document.addEventListener(type,q.eventHandler,true)
   q.originalSet=CSSStyleDeclaration.prototype.setProperty
   CSSStyleDeclaration.prototype.setProperty=function(name,...args){if(['--edge-proximity','--cursor-angle','--spot-x','--spot-y'].includes(name))q.writes++;return q.originalSet.call(this,name,...args)}
   let last=performance.now();const frame=now=>{q.times.push(now-last);last=now;if(q.running)requestAnimationFrame(frame)};requestAnimationFrame(frame)
  })
  const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.start',{categories:'devtools.timeline,cc',transferMode:'ReturnAsStream'})
  const before=await system.send('SystemInfo.getProcessInfo'),start=performance.now()
  for(let i=0;i<160;i++){await p.mouse.wheel(0,Math.floor(i/40)%2===0?25:-25);await new Promise(r=>setTimeout(r,16))}
  const after=await system.send('SystemInfo.getProcessInfo'),elapsed=(performance.now()-start)/1000,cpu={}
  for(const a of after.processInfo){const old=before.processInfo.find(x=>x.id===a.id);if(old)cpu[a.type]=(cpu[a.type]||0)+(a.cpuTime-old.cpuTime)/elapsed*100}
  const frames=await p.evaluate(()=>{const q=window.exploreQA;q.running=false;CSSStyleDeclaration.prototype.setProperty=q.originalSet;for(const type of ['pointerover','pointerout','pointermove','wheel','scroll'])document.removeEventListener(type,q.eventHandler,true);const t=q.times.slice(1).sort((a,b)=>a-b);return {events:q.events,writes:q.writes,mean:t.reduce((a,b)=>a+b,0)/t.length,p95:t[Math.floor(t.length*.95)],over16:t.filter(x=>x>16).length,over25:t.filter(x=>x>25).length}})
  await cdp.send('Tracing.end');const{stream}=await done;let data='';while(true){const x=await cdp.send('IO.read',{handle:stream});data+=x.data;if(x.eof)break}await cdp.send('IO.close',{handle:stream})
  const trace=JSON.parse(data).traceEvents,sums={};for(const e of trace)if(e.ph==='X'&&e.dur&&['Layout','UpdateLayoutTree','Paint','FunctionCall','EventDispatch','FireAnimationFrame'].includes(e.name)){const a=sums[e.name]||={ms:0,count:0,max:0};a.ms+=e.dur/1000;a.count++;a.max=Math.max(a.max,e.dur/1000)}
  results.push({name:scenario.name,frames,cpu,sums});console.log(JSON.stringify(results.at(-1)));fs.writeFileSync(`${outputPrefix}-${scenario.name}.trace.json`,data);await style.evaluate(el=>el.remove())
 }
 fs.writeFileSync(`${outputPrefix}.json`,JSON.stringify(results,null,2));
 await browser.close()
})().catch(e=>{console.error(e);process.exit(1)})
