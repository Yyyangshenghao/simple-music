# 封面粒子云 Shader 化升级设计

日期:2026-07-12
状态:待实现

## 背景

当前 `src/components/Visualizer/CoverParticleCloud.tsx` 的封面粒子云效果被反馈"效果差",具体问题:

1. **形状/轮廓难看**:96×96 采样时过滤掉亮度 <20 的暗色像素,深色专辑封面会出现大片空洞,认不出封面图案。
2. **动效太单调**:所有粒子共用一个整体 `bassEnergy` 标量驱动 `pts.rotation`/`pts.scale`,没有逐粒子差异,观感呆板。
3. **音乐律动感弱**:只取频谱前 16 个 bin(约 sub-bass/bass 范围),没有鼓点/节拍层面的响应。
4. **整体质感不够**:没有辉光、没有逐粒子明暗变化,缺少"专业可视化"的精致感。

参考项目 `/Users/yangshenghao/github/YPM_Fork/YesPlayMusic` 的 `src/components/Visualizer/CoverParticleScene.js` 有更成熟的实现(该文件注释显示它本身是参考 Mineradio 早期封面粒子预设做的加强版,形成互相借鉴关系),核心思路可移植:密集网格采样、GLSL shader 驱动的逐粒子径向频段响应、鼓点涟漪、辉光叠加层。

## 目标与非目标

**目标**:在现有 R3F(`@react-three/fiber`)架构内,重写 `CoverParticleCloud` 的音频驱动方式为 shader-based、逐粒子响应,修复轮廓完整性,并让相机不再打断封面可辨识度。

**非目标**:
- 不引入 postprocessing/EffectComposer 依赖,辉光靠额外的 additive `<points>` 层模拟。
- 不改动 `Waveform3D`/`SpeakerParticles` 的实现方式,也不强制它们复用新的多频段分析函数。
- 不改变 `EffectSwitcher`/`LyricsPanel` 的效果注册机制与 UI。

## 架构

保持 R3F 声明式风格,不脱离现有 `<Canvas>` 共享架构(三个 3D 效果继续共用同一个 Canvas 与 `EFFECT_COMPONENTS` 查找表)。改动集中在三个文件:

- **`CoverParticleCloud.tsx`**(核心重写):`THREE.Points` 几何体不变,但材质从 `pointsMaterial` 改为自定义 `<shaderMaterial>`(GLSL vertex + fragment),另加一层共享 geometry 的辉光 `<points>`。这是本仓库第一次引入自定义 shader,遵循 R3F 惯例用 JSX `<shaderMaterial args={[{ uniforms, vertexShader, fragmentShader }]} />`。
- **`src/lib/audio-energy.ts`**(新增函数):新增 `bandEnergiesFrom(data): BandEnergies`,把现有 1024-bin 频谱(fftSize=2048)按近似频率范围切成 7 段(subBass/bass/lowMid/mid/highMid/presence/air),复用已有的 `spectrumSlice`。只被 `CoverParticleCloud` 使用,不影响 `bassEnergyFrom` 现有调用方(`Waveform3D` 等保持不变)。
- **`CinemaCamera.tsx`**(最小改动):开头读取 `useSettingsStore.getState().lyrics3dEffect`,若为 `'cover-cloud'` 则直接 `return null` 前跳过本帧相机操作,交由 `CoverParticleCloud` 自己通过 `useThree()` 控制相机。其余两个效果行为不变。

不改动 `LyricsPanel.tsx`、`EffectSwitcher.tsx`、`types/domain.ts`。

## 采样与密度

- 移除暗色像素过滤(`brightness >= 20` 判断整段删除),黑色区域保留为暗色粒子而非空洞,保证封面轮廓完整。
- 采样分辨率从固定 96×96 改为按性能档位的正方形网格边长,直接决定粒子数(不再是"从有效像素里重复取样凑够 maxCount"这种间接方式):

  | 性能档 | 网格边长 | 粒子数 |
  |---|---|---|
  | eco | 96 | 9,216 |
  | balanced | 130 | 16,900 |
  | high | 160 | 25,600 |
  | ultra | 190 | 36,100 |

- 离屏 canvas 尺寸随网格边长同步调整(不再固定 96×96)。
- 粒子初始位置铺成平面网格(z=0),不再有现有的 ±1.2 随机深度扰动——深度感全部交给 shader 的音频驱动位移与idle 呼吸微抖(见下),更贴近参考版"平整封面墙"的观感,也让密集网格不会因为随机 z 抖动而糊成一团。
- 切歌重采样沿用参考版的分帧写入策略:`requestIdleCallback`(无该 API 时 `setTimeout` 兜底)按列分块(如每次 32 列)增量写入 `aColor`/`aBrightness` attribute,避免高密度网格在切歌瞬间同步重建导致掉帧;用递增 token 作废上一次未完成的重建,防止快速切歌时竞态写花缓冲。

## Shader 音频驱动设计

**新增 uniform**(通过 `bandEnergiesFrom` 每帧写入):`uSubBass` `uBass` `uLowMid` `uMid` `uHighMid` `uPresence` `uAir` `uEnergy` `uTime`,以及涟漪相关的 6 槽位数组 uniform(`uRippleTime[6]` `uRippleStrength[6]` `uRippleCenter[6]` `uRippleBlast[6]`)。

**vertex shader 核心逻辑**(移植自参考版,坐标系适配本项目 [-4,4] 世界单位):
- 按粒子到中心的归一化距离分三区:内圈(`<0.6`)吃 `subBass+bass`,中圈吃 `lowMid+mid`,外圈吃 `highMid+presence+air`,分别沿粒子本地 +Z 朝镜头弹出。
- 每颗粒子按 `aRandom`(初始化时写入的随机相位)叠加一个正弦 idle 抖动 + 缓慢呼吸,保证安静段落也不呆板。
- 亮度(`aBrightness`,采样时从 RGB 均值算出)越高的粒子弹得越明显,暗部弹幅衰减但不为零。
- 点尺寸按视距衰减(`gl_PointSize` 用 spacing/focal 计算)乘一个随低频涨缩的 `audioBoost`,涨缩幅度收小,律动主要靠 Z 位移体现,避免点放大后糊成一片。

**鼓点涟漪**(组件内 `useRef` 维护状态,不用 React state,逻辑仿参考版 class 字段写法):
- 每帧检测 `subBass+bass` 是否上升沿突破阈值(如 0.38)且距上次触发 >0.1s,若是则在随机中心点触发一道新涟漪,写入 6 个槽位中的下一个(环形复用)。
- vertex shader 里对 6 道涟漪分别计算"环形波纹到达粒子的距离差"驱动额外 Z 抬升;强鼓点(峰值超过高阈值)触发命中粒子的短暂 XY 飞散,涟漪消退后自然回落。

**辉光层**:额外渲染一个共享同一 `BufferGeometry` 的第二个 `<points>`,材质是同一套 vertex shader + 更柔和的 fragment shader(圆形软化、按弹跳量提亮),点径更大、`AdditiveBlending`、`depthWrite={false}`,叠加在主层之上模拟辉光,不引入 postprocessing 依赖。

**fragment shader**(主层):圆形粒子(`gl_PointCoord` 距中心 >0.5 则 `discard`),按弹跳量(`vLift`)轻微提亮颜色,边缘做 `smoothstep` 软化抗锯齿。

## 相机行为

`CoverParticleCloud` 激活时不再使用 `CinemaCamera` 的环绕逻辑,改为组件内部通过 `useThree()` 拿到相机:

- 固定距离正对粒子墙(根据 FOV 与网格半宽计算,类似参考版 `dist = gridHalf / tan(fov/2)`)。
- 用两层 group 嵌套:`tiltGroup`(固定倾角,当前设为 0,即正面朝向相机)包 `spinGroup`(绕 X/Y/Z 用正弦/余弦做小幅摇晃,如参考版 `sin(t*0.5)*0.06` 量级),不整圈自转。
- 组件卸载或切到其他效果时,`CinemaCamera` 恢复接管相机(其内部逻辑本身是每帧幂等设置 position,切换效果的下一帧就会立刻纠正相机状态,不需要额外的"归位"过渡代码)。

## 帧率与性能

- 仅 `eco`/`balanced` 档做节流:在这两档下,`useFrame` 内按目标间隔(如 1000/30ms)跳过本帧的音频分段计算、涟漪状态推进与 uniform 写入(uniform 保持上一帧的值不变)。`high`/`ultra` 档不限。
- **已知权衡**:由于当前三个 3D 效果共享同一个 R3F `<Canvas>` 且 `frameloop='always'`,跳过 uniform 更新不会跳过 GPU 的 `renderer.render()` 调用本身(那需要改 Canvas 全局的 `frameloop` 策略,会影响另外两个效果,本次不做)。因此这里的"节流"实际收益是**省 CPU 端**的频谱分析与涟漪状态计算开销,GPU 端仍按 Canvas 默认帧率渲染(但由于 shader 输入没变,内容等同于重复上一帧,渲染成本本身很低)。不是参考版那种真正跳过 `render()` 调用的严格 FPS 上限,如果后续需要更彻底的省电,需要评估把 Canvas 改成 `frameloop='demand'` 的全局改动。

## 涉及的文件改动清单

- `src/components/Visualizer/CoverParticleCloud.tsx` — 核心重写(shader、密集采样、涟漪、相机接管)
- `src/lib/audio-energy.ts` — 新增 `bandEnergiesFrom()`
- `src/components/Visualizer/CinemaCamera.tsx` — 加一段短路判断,cover-cloud 时不接管相机

不涉及数据库/API/IPC/持久化格式改动,`performanceMode`/`lyrics3dEffect` 现有设置字段直接复用,无需迁移。

## 验证方式

- `npm run typecheck` 通过。
- 手动在 Electron 里切到 3D 歌词模式 → 封面粒子云,验证:深色封面轮廓完整可辨、随音乐能看到中心低频粒子明显弹跳/外圈高频粒子轻微响应、鼓点时出现涟漪扩散、切歌时无明显掉帧、切换性能档位粒子数量随之变化、切换到其他两个 3D 效果时相机恢复环绕且无跳变。
- 长时间播放(切多首歌)观察内存是否稳定(geometry/material 是否正确 dispose,尤其辉光层与分帧重建的 idle callback 在卸载时要能取消)。
