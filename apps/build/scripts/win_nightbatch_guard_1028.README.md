# win_nightbatch_guard_1028.ps1 — 夜批发车前置守护(三段)

> 依据:`.trellis/tasks/10-28-windows-mystudio-q21-mainline/` design.md §2.3(三段)/§2.4(FastH3 前置接线)、prd.md §三 D8 裁定 / §五 W9、research/phase2-3-receipt-1028.md(S7 三阻断)、research/final-sweep-1028.md(**判静勘误 §一.5末/§四.1/§四.4;回滚通道不存在 §一.5末**——1028 收官复核坐实)。零常驻新组件;恢复逻辑内生在发车脚本(D8 否决裸探活门与常驻看门狗)。

## 一、三段+可选判静门说明(design §2.3;④=1028 收官复核勘误增强)

| 段 | 行为 | 判据与出处 |
|---|---|---|
| ① probe | `GET http://127.0.0.1:17595/health`(缺省 5s 超时)。通=守护过 `exit 0`,附记引擎 17000 状态 | 真身路由是 **`/health`(免鉴权)**,`apps/backend/image_gen/server.py:5,214-223`;design 文本写的 `/healthz` 是文档笔误,全 repo 无此路由,实现以代码为准。鉴权路由才要 token(fail-closed,`server.py:172-182`),本探针不需要 |
| ② recover | ①不通 → 拉起 `manying-studio.exe`(缺省 `$env:LOCALAPPDATA\Programs\manying-studio\manying-studio.exe`,phase0 探子 A1/A2 实证;**进程名=manying-studio,design 文本的 anying-studio 系 findstr 子串笔误**)→ 轮询 `17595 /health` + `17000 /system_stats`,上限 5min(缺省 300s/10s 间隔)。进程已在驾不重复拉(幂等),不强杀重启 | 引擎由**首个 execute 请求按需拉起**(prd §二.20:`apps/backend/image_gen/pipeline.py:278`、`apps/backend/comfyui/execute.py:299` 调 `ensure_engine_ready`,`engine_manager.py:1989`)——故缺省**引擎未就绪不单独判死**,侧车通即放行,夜批首笔触发引擎 |
| ③ abort | 侧车仍不通 → 写日志 + `exit 2` **禁发** | 夜批发车脚本必须以本脚本 `exit 0` 为发车前置;禁发优于白等一夜(D8) |
| ④ queue-idle 判静门(可选 `-RequireQueueIdle`) | 前三段全过后、`exit 0` 前:持续采样 `GET http://127.0.0.1:17000/queue`,要求 `queue_running`+`queue_pending` **全空贯穿观察窗**(缺省 900s=15min,`-QuietWindowSec` 可调;任一样本非空或 `/queue` 不可达 → `exit 2` 禁发) | **复核证伪第一条**(final-sweep-1028.md §四.4):单点 output 快照判「引擎 idle」不成立——发车前置判静须含引擎 `/queue` API 现查(`queue_running` 空)**而非仅看 output mtime**,且禁凭单点须持续观察窗;判静语义=repo 同款 `apps/backend/engines/image_engine/engine_health.py:94-101`(running+pending 均空才算空,探不到=证不了静按不空处置 fail-closed)。蕴含引擎 17000 须可达;仅覆盖引擎侧信号,完整判静见 §三 |

**退出码**:`0`=守护过可发车;`2`=abort 禁发(侧车不通,或 `-RequireEngine` 下引擎不通,或 `-RequireQueueIdle` 下 `/queue` 非静/不可达);`3`=本地配置错禁发(App exe 缺失/拉起失败)。
**日志**:缺省 `E:\IP\tmp\logs\win_nightbatch_guard_1028.log`(追加写,可 `-LogFile` 改);每行同步打屏。
**参数**:`-AppExe` / `-LogFile` / `-ProbeTimeoutSec`(5)/ `-TimeoutSec`(300)/ `-PollIntervalSec`(10)/ `-RequireEngine`(开关,见下)/ `-RequireQueueIdle`(开关,判静门见下)/ `-QuietWindowSec`(900)。

### `-RequireEngine`(引擎直投轨专用)

缺省关=execute 轨语义(侧车通即过,引擎首笔按需拉)。发车**直打 17000 `/prompt`**(不经 execute 链)的批产——如 FastH3 主路(10-27 fasth3 役附录A 直投配方)——引擎不在驾即发必死,应加 `-RequireEngine`:引擎 17000 也作硬门,5min 内未就绪同样 `exit 2` 禁发。

### `-RequireQueueIdle`(判静门,并行基准役实弹期必加)

并行超分役 `fasth3-upscale-shootout-1028` 实弹期,**发车前置判静不过即禁发**(§三)。本开关把判静三项中的引擎侧信号(第 2 项 `/queue` 清空)做成机检:观察窗内每 10s(`-PollIntervalSec`)采样一次,任一样本 `queue_running`/`queue_pending` 非空、或 `/queue` 探不到,均 `exit 2` 禁发——fail-closed:证不了静=不静。窗口缺省 **900s=15min**(任务纪律:观察窗≥15min,禁凭单点,`-QuietWindowSec` 可调)。**覆盖面如实**:第 1/3 项(Mac 侧 `vram-4x.csv` 停增+output 停更)Windows 侧脚本够不着,由发车人在 Mac 侧按 §三 观察;正确次序=判静三项齐 → 跑本守护(带本开关)→ `exit 0` 方发。

### 已知边界(1028 实测,如实——非脚本缺陷)

- **App 启动本身不拉侧车**:侧车 spawn 仅由渲染层动作触发(生成前自愈/设置页「准备运行时」,`apps/frontend/lib/ai/image-generation-engine.ts:146-176`;S7 阻断②,Mac 侧同款实证:App 启动 45s 后 17595 仍 refused);
- **App 家共享 Python 3.12 尚未配置**(Phase 1b 人工步=App UI 设置→Python 配置;S7 阻断①,`image-gen-runtime-controller.ts:311-319` python.exe 缺失即 spawn 硬拒);
- 推论:**Phase 1b 完成前**,冷启场景(App 不在驾)②轮询大概率等不来侧车 → 走 ③abort 禁发,属设计内行为。当前 Windows 终态(1028 回执)=引擎 17000 在驾(EngineDurable 辖)、17595 无监听——裸跑本守护将 abort,正是回执记录的现状。

### 回滚通道(引擎管辖权,design §2.1/§2.6)

EngineDurable 禁用留档=极端回滚通道(任务定义与仓外 engine_task.py 恒不删)。**回滚=两条命令回旧管辖**:

```
schtasks /Change /TN EngineDurable /ENABLE
schtasks /Run /TN EngineDurable
```

启用+重跑任务后,引擎回到计划任务旧管辖,17000 由其拉起,本守护段照常工作(①probe 只认端口活性,不问管辖)。

**数据/种子面无回滚通道(如实标注,final-sweep-1028.md §一.5末挑毛病②)**:W8 播种链(daojie-data 5 件/json 真源 7 件/四指路件)全链零备份,旧档均已覆写销毁——Windows 侧**无法回滚到播种前**,**Mac 正向重刷为唯一路**(若 App 退出时内存态回写覆盖指路件,同样只能 Mac 正向重播)。勿设想任何 Windows 侧回退手段。

## 二、FastH3 批产脚本前置接线示例(design §2.4)

**原则:既有批产脚本仅前置守护段,发车通道不变**(引擎直投 17000 / execute 链双轨照旧)——EngineDurable 禁用后「引擎在驾」由守护段保证,最小改动面。

### 接线一:引擎直投轨(FastH3 主路形态)——加 `-RequireEngine`

启动器 bat(例 `E:\IP\tmp\fasth3_nightbatch_1028.bat`):

```bat
@echo off
REM FastH3 夜批发车启动器(示意)——仅前置守护段,发车通道不变
powershell -NoProfile -ExecutionPolicy Bypass -File E:\IP\MYStudio\apps\build\scripts\win_nightbatch_guard_1028.ps1 -RequireEngine
if errorlevel 1 goto :abort
REM ↓↓↓ 既有批产命令原样保留,一行不改(此处为示意占位) ↓↓↓
D:\Python312\python.exe -X utf8 E:\IP\MYStudio\apps\build\scripts\<既有批产脚本>.py >> E:\IP\tmp\logs\<batch名>.log 2>&1
exit /b %ERRORLEVEL%
:abort
echo [guard] ABORT - dispatch blocked >> E:\IP\tmp\logs\<batch名>.log
exit /b 2
```

> 并行基准役实弹期(§三 判静不过即禁发),上面守护行应再加 `-RequireQueueIdle`(④判静门机检引擎侧 `/queue`,Mac 侧两项仍须发车人观察)。

长批走 schtasks 一次性任务(MossBatch14 模式,prd W9;SSH 会话杀 detached 子进程前科,禁挂会话):

```
schtasks /Create /TN FastH3NightBatch /SC ONCE /ST 23:59 /TR "cmd /c E:\IP\tmp\fasth3_nightbatch_1028.bat" /F
schtasks /Run /TN FastH3NightBatch
REM 毕后:schtasks /Delete /TN FastH3NightBatch /F
```

### 接线二:execute 轨(经 17595 `/comfy/execute`)——裸跑守护

守护通过即发;引擎不在驾也没关系,首笔 execute 触发 `ensure_engine_ready` 按需拉起(prd §二.20):

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File E:\IP\MYStudio\apps\build\scripts\win_nightbatch_guard_1028.ps1
if errorlevel 1 exit /b 2
REM ↓ 既有 execute 链发车命令原样保留 ↓
```

> 手动验守护(不看批产):`powershell -NoProfile -ExecutionPolicy Bypass -File win_nightbatch_guard_1028.ps1` 后看 `%ERRORLEVEL%`。
> 产物纪律(prd W9):批产物先落引擎 output 即转移 `E:\IP\tmp\` 中转,再按 apps/output 拷贝纪律回流 Mac(保留原路径结构);产物真源恒=Mac(D2)。

## 三、发车判静纪律(并行基准役实弹期禁发;按 1028 收官复核勘误重写+终局链证伪 D 判静勘正)

**硬禁令(任务纪律原话)**:并行超分役 `fasth3-upscale-shootout-1028` 实弹期(**判静不过**):**禁杀引擎、禁改 EngineDurable、禁发任何 prompt**——其逐秒 VRAM 基准数据,排队插入也会污染其计时(1028 收官实录:其 prompt 12bf7bb6 实弹贯穿收官轮全程,final-sweep-1028.md §一.1/§一.6)。

**判静真源=引擎 `/queue` 清空+output 停更两项综合+持续观察窗 ≥15min,禁凭单点**(final-sweep-1028.md §一.5末挑毛病①坐实:单点 output 快照判「引擎 idle」不成立;§四.4 勘误:后续判静应改用「队列空+持续观察窗」判据;**1028 终局链复核证伪 D 再勘正(final-chain-1028.md §四.D、遗留 §三.12)**:原三项之 `vram-4x.csv`=死传感器已坐实除名,判静口径就此收敛为两项):

1. ~~Mac 侧 `vram-4x.csv` 停增~~ **已除名=死传感器(1028 终局链复核证伪 D 坐实,final-chain-1028.md §四.D)**:采集器 2026-10-28 14:17 停采后并行役从未停工(引擎 output 21:22/21:31 仍新落 vosr2-vfx-2x 两件、23:27 `queue_running` 持 VOSR2-4x prompt 71be55d8 在跑,而 CSV 恒停 458810B/mtime 14:17:24 不动)——**CSV 停增不构成收工证据,判静禁再凭 CSV**(该传感器 Mac 侧真源 `apps/output/fasth3-upscale-shootout-1028/seedvr2-win/vram-4x.csv`;历史勘误「禁查 `E:\IP\tmp`」存档见 final-sweep-1028.md §四.1);
2. **引擎 `/queue` 清空**——现查 `GET http://127.0.0.1:17000/queue`,`queue_running` 空(兼查 `queue_pending`,repo 同款判静语义=`apps/backend/engines/image_engine/engine_health.py:94-101`:running+pending 均空才算空,探不到=证不了静按不空处置)。本守护 `-RequireQueueIdle`(§一④)即此信号的机检——观察窗内持续采样,非单点;
3. **output 停更**——引擎 `output\` 无新文件持续生成(非单点 mtime 快照,须与第 2 项同窗观察;真层=`E:\IP\漫影工作室\comfyui\output`,经 `E:\IP\*` 通配符绕中文实测,final-chain-1028.md §一.3)。

两项(第 2+3 项)齐+观察窗 **≥15min** 后方可进入发车流程;判静先于守护——本守护探针虽只读(GET `/health`、`/system_stats`、`/queue`,不进生成队列),但夜批发车整体以判静为前提。**机检覆盖面如实**:`-RequireQueueIdle` 只覆盖第 2 项(引擎侧);第 3 项(output 停更)本脚本未做机检,由发车人观察,脚本不代劳(第 1 项已除名)。**终局链复核后遗注(final-chain-1028.md §四.D)**:守望时点(20:12-20:32)读数为真,但判静窗已闭、环境转非静——后续任何发车决定须重过判静门(`-RequireQueueIdle` 判静不过即禁发)。

**判静后的前置核对**:确认 EngineDurable 终态(S6 禁用留档重做窗口=并行役真收工后,final-sweep-1028.md §二)——若其时 EngineDurable 仍 Ready 且引擎在驾,直投轨 `-RequireEngine` 守护自然放行;禁用留档落地后则依赖 App 在驾链+execute 轨按需拉起,直投轨须先确认引擎在驾再发。

---
*1028 落档:本件+同目录 `win_nightbatch_guard_1028.ps1`;补 W11(S8 FastH3 共存复核)时以本守护为发车前置复核冒烟。同日修缮(上轮遗留工程首件):§三判静纪律按收官复核勘误重写(真源三项综合+观察窗≥15min+禁查 E:\IP\tmp)+守护加 `-RequireQueueIdle` 判静门(`/queue` 机检,复核证伪第一条的判据增强)+回滚注记补 daojie 无通道(Mac 正向重刷唯一路)。*
