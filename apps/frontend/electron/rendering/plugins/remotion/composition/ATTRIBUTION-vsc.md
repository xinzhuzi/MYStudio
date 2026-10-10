# ATTRIBUTION — video-shotcraft 镜头配方嫁接(vsc:*)

## 来源

- **上游仓库**:<https://github.com/Vincentwei1021/video-shotcraft>
- **钉死 commit**:`5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab`(2026-09-28,feat(workbench): add Russian interface)
- **上游许可证**:Apache License 2.0(见上游仓库 LICENSE;本目录对其代码的改写与
  再分发依 Apache-2.0 第 4 条进行,此处保留来源声明与显著修改说明)
- **本仓库角色**:上游以 Video ShotCraft 插件形态长期保留为知识库+参照源(任务决议
  D8:持续跟版,升版=改一行 commit 常量);渲染能力一律经本文件所述嫁接进固定
  bundle,插件运行时下载内容永不进渲染。

## 嫁接文件对照(批A-1 地基 + 批A-2 其余四组件)

| 上游路径(@ 5ddbf521) | 本仓库路径 | 改写方式 |
| --- | --- | --- |
| `assets/lib/helpers/rand.ts` | `composition/recipes/vsc-helpers.ts` `mulberry32` | 数值算法逐值等价重写(同种子同序列;测试烧金样) |
| `assets/lib/helpers/motion.ts` | 同上 `velocityAt`/`lagged`/`dampedSettle` | 语义等价重写(纯函数,逐条对齐上游单测意图) |
| `assets/lib/helpers/shake.ts` | 同上 `handheld` | 逐值等价重写(分层正弦常数不变) |
| `assets/lib/helpers/camera.tsx` | 同上 `camScalarAtFrame`/`camSegmentProgress`/`VSC_EASE_IN_OUT` | **降维改写**:上游 Rig 是 @react-three/fiber 机位组件(pos/look/fov);本仓库 2D 管线只取其「逐段缓动插值」数学(数值=Remotion 多停靠点 interpolate 逐段 easing,测试核对),three.js 依赖剥离 |
| `demos/camera/crash-zoom-punch/CrashZoomReal.tsx` + `CrashImpactReal.tsx` | `composition/recipes/crash-zoom-punch.tsx` + `vsc-helpers.ts` 的 `crashZoomScaleAtFrame`/`impactShakeAtFrame` | 参考实现改写,曲线常数逐值对齐(rebound 段测试逐帧核对上游 interpolate 表达式;震屏包络 14px·e^(−t/1.8)、双轴 sin 频率 3.3/4.1 不变) |
| `demos/camera/tension-camera-moves/DutchRollToLevel.tsx` | `composition/recipes/dutch-roll-to-level.tsx` + `vsc-helpers.ts` 的 `dutchRollAtFrame` | 参考实现改写,三通道(rotate/纵漂/scale)逐帧核对上游公式(测试重写上游分支表达式全帧 toBeCloseTo);漂移正弦常数 0.035/0.05、fade 窗 [ROLL, ROLL+6] 不变 |
| `demos/camera/tension-camera-moves/SlowPushIn.tsx` | `composition/recipes/slow-push-in.tsx` + `vsc-helpers.ts` 的 `slowPushAtFrame` | 参考实现改写,scale/暗角同走 Easing.in(quad)(测试逐帧核对上游 interpolate);暗角渐变串逐字节同串 |
| `demos/camera/tension-camera-moves/PullBackIsolation.tsx` | `composition/recipes/pull-back-isolation.tsx` + `vsc-helpers.ts` 的 `pullBackAtFrame` | **单镜版改写**(见下节改造 6);后拉 out(cubic)/沉黑 inOut(quad)/光晕窗 60–100f 逐帧核对上游公式 |
| `demos/camera/space-camera-moves/DroneDiveLanding.tsx` | `composition/recipes/drone-dive-landing.tsx` + `vsc-helpers.ts` 的 `droneDiveProgressAtFrame`/`droneDiveAtFrame` | 参考实现改写,一条 p 双段(in(cubic) 82% + out(poly(5)) 18%)逐帧核对上游 pDive/pLand;CameraMotionBlur(220/9) 全场包、软影/悬空阴影/boxShadow 常数不变 |
| `references/shots/camera/{crash-zoom-punch,tension-camera-moves,space-camera-moves}.md` | 组件/曲线参数默认值 + 本仓库 `lib/studio/remotion/vsc-recipes.ts`(批B 建档) | 卡片参数表转写为烧死默认值(决议 D4) |
| `demos/typography/brand-ink-open/BrandInkOpen.tsx`(批D) | `composition/recipes/brand-ink-open.tsx` | 参考实现改写,曲线常数逐值对齐(准星 0→9f/8→18f/24→34f 淡出、逐字 delay=10+i·3/12f/scale 1.6→1/blur 6px→0、glint ±4f、kicker 0.7f/字符 28f 起、退场 97→104f 上浮 40px+缩 12%+淡);文案参数化(wordmark/kicker 经 workflowConfig 注入)、字体改 Noto Serif SC 900(fontsource 固定 bundle)、时长=参考实现定稿 104f |
| `demos/outro/grain-dissolve/GrainDissolve.tsx`(批D) | `composition/recipes/grain-dissolve-outro.tsx` | 参考实现改写,四段曲线(burst 0.13–0.28 outCubic/cond 0.60–0.71 inOutCubic/lock 0.68–0.90/settle 0.88–1)与辉光包络 burst·0.3+cond·0.7−settle·0.45、滤镜链(feTurbulence baseFreq 0.9→+0.4/seed floor(t·46)/displacement 峰值 52/blur 1.1px)、选区框几何/斜纹间距 34/HUD 括角坐标逐值对齐;`_fixtures/Motion` 的 seg/E/useT 就地等价重写、DesignStage 剥离(SVG viewBox 640×360 铺满);文案参数化(tagline/shortMark),短标字号自适应(>6 字符每字缩 3px 下限 36px,卡片已知坑) |
| `references/shots/{opening/brand-ink-open,outro/grain-dissolve}.md`(批D) | 章级配方注册与分发 `composition/recipes/chapter-vsc-recipes.tsx` + props 校验(composition-props-validation.ts) | 卡片参数表转写为烧死默认值(决议 D4);开篇/章尾不进镜头运镜注册表 VSC_RECIPES(槽位不同),章级闭集自持 |

## 显著改造(Apache-2.0 第 4 条「modified files」声明)

1. **媒体桥改造**:上游 demo 消费产品截图纹理槽(`_textures/live/projects-full.png`
   + 高清目标卡 `card4-hires.png` 双贴图结构,页面坐标系硬编码 1920×pageH)。
   本仓库剥离全部 UI 假素材——单一分镜静图经 media bridge capability URL 直供
   (`src` prop),推近目标由 `originX/originY` 画面百分比给出,cover 满幅。
2. **确定性渲染铁律**:禁 `Math.random()`/`Date.now()`(上游 demo 本就合规);
   新增 `shotSeed(shotIndex, salt)`(FNV-1a)作为种子从镜头 index 派生的唯一入口,
   供后续需要随机化的配方使用;本批七卡曲线闭式无随机。
3. **CameraMotionBlur 窗口口径**:上游两 demo 窗口不同(CrashZoomReal
   [start−2, hit+2]、CrashImpactReal [start−2, hit])——按卡片「只包急推段」
   语义归一:impact 款 [start−2, hit](震屏段保持清晰抖动)、rebound 款
   [start−2, hit+2](回弹初速仍高),`crashZoomBlurWindow()` 单源。
   drone-dive 按其卡片「全场包 CameraMotionBlur(shutterAngle 220, samples 9)」
   无窗口直包(上游同款);其余五卡无 motion-blur。
4. **参数烧死卡片默认值**(决议 D4):6f / 1→2.6 / 回弹 (2.6−2.45)/2.6≈5.77% /
   震屏 14px·τ1.8;dutch-roll −10°/±0.8°/14f+10f/1.15→1.08;slow-push
   120f/1.00→1.14/暗角 0.5;pull-back 110f/2.2→0.62/沉黑 60–110f/光晕 0.35;
   drone-dive 20f hold/25f+20f/82%·18%/72°→0/0.42→1.35。
   `motionParams` 首批不接 AI 不接 UI。
5. **上游已知坑承接**(卡片自注,design §6):「参数经占位素材调校转正,非实战
   定稿」——首批实弹渲染后须回验,差异记录回本文件(见下节)。
6. **批A-2 各卡改造明细**:
   - **dutch-roll-to-level**:上游的痛点警示条/解决方案卡两层 UI 覆盖物
     (叙事道具)剥离,「世界被扶正」由滚正曲线本身承载;单图 cover。
   - **slow-push-in**:顶点硬切后的亮景 B(上游 FakeDashboard 静止 30f)不
     嫁接——硬切语义留给转场链(本组件只做景 A 推近+暗角,到 120f 钳制
     持住终点)。
   - **pull-back-isolation(单镜版)**:上游 1 主卡 + 8 兄弟卡按 hypot 距离
     错峰熄灭(帧 30 起每 8f 一张)的多卡布局整体剥离,主体=整张分镜静图;
     「背景沉黑」由画面外背景色 236→20 + 主体白光晕(无压暗滤镜)承接。
     章尾多实体版归批D。
   - **drone-dive-landing**:上游 transformOrigin 钉 demo 网格特定格
     (518,335)、平移 [256,150]→[442,205];本版推广为 originX/Y 百分比锚点
     (缺省中心,终位=锚点对准画面中心),起手偏移沿用上游
     (774,485)−(960,540)=(−186,−55);帧尺寸经 useVideoConfig 取真值。
7. **批D 章级段改造明细**(10-10 批D,design §5「ChapterVideo 前后段」路线):
   - **brand-ink-open(章头开篇)**:上游是产品品牌台(amber 强调色+纸底),
     本仓库文案参数化(workmark=作品名/kicker=副标,经 workflowConfig 注入);
     时长取参考实现定稿 104f(卡片「约 2.8s」为早期版本,demo 已含 R1
     「完整标题停留 1 秒」硬底线);kicker 缺省时整行隐藏。
   - **grain-dissolve(章尾)**:能量曲线承接(开场低开→中段推进→outro 峰值,
     卡片互文);D1 的「章级三件」(tilt-reveal/tabletop-drop/pull-back 章尾版)
     未入批D 指令面,章尾选 grain-dissolve(卡点能量聚合拍,自包含 SVG 滤镜)。
   - 两段均为 ChapterVideo 前后 Sequence 段(单次 renderMedia 出一条 MP4,
     不拆独立 Composition——spec §3 concat 禁令),不进镜头运镜闭集。

## 实弹回验记录

(首批 smoke 渲染后填写:卡片默认值 vs 实际观感,差异与调参留档。)
