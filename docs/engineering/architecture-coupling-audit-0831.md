# 架构耦合体检报告(2026-08-31)

> 体检工具:`apps/build/scripts/architecture_coupling_audit.py`(可反复运行,只读扫描)
> 明细数据:`apps/build/scripts/arch-coupling-report.json`
> 定性验证:GitNexus 图谱本次因 WAL 毒化不可用(MCP 连接断/CLI 卡回放),跨域引用清单由扫描脚本全量枚举,精确到每一条 import 语句,对文件搬移类重构而言比图谱更完备。

## 结论速览

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | `panels/sclass → panels/director` 33 处跨域引用,director 域的 storyboard 模块被 sclass 整包复用 | 高 | **本次治疗** |
| 2 | `image_gen` 四引擎混杂在 pipeline.py(1083 行)/model_cache.py(687 行)/download_model.py | 高 | **在途**:任务 08-31-engine-separation,`engines/` 目录已建未接线(untracked),勿抢跑 |
| 3 | 后端 9 包 `model_cache.py` 复制粘贴(2182 行,6 个函数 ≥5 包同名) | 中 | 治疗方案在档,**被在途改动阻塞**(audio/music3/sfx 三包 model_cache.py 正被并行改动) |
| 4 | `electron/main/main.ts` 1885 行/109 imports 巨石编排文件 | 中 | 报告在档,拆分需单独立项 |
| 5 | `layer_separation → depth_estimation`、`video_use → tts` 跨包 import | 低 | 报告在档 |
| 6 | 前端分层铁律(panels→features→ui→hooks→lib 单向;lib 零 React) | — | **违规 0**,08-30 裁定(b4ba766)持续有效 ✅ |

## 明细

### 1. sclass → director 跨域耦合(本次治疗对象)

`sclass`(hotflow2024 AGPL 遗产面板)从 `director` 域整包 import 了 26 个模块——分镜生成执行器、合并格工具、参考图归一化、场景卡控件(情绪标签/景别/时长/提示词面板)等。这些模块事实上是**双面板共享的分镜生产域代码**,却住在 `director` 一个面板的目录里。

- 后果:director 域无法独立演进(任何改动波及 sclass);sclass 的依赖方向穿透面板边界;与既有 `features/storyboard/`(angle-switch、quad-grid 已有先例)的分层意图相悖。
- **治疗**:把共享模块抽到 `components/features/storyboard/`(分层裁定 08-30 明确 panels→features 单向,features 层正是多面板共享域的家)。搬移集取「被 sclass 引用的模块 + 其在 director 内的传递闭包」,闭包内模块若 import 非共享 director 文件则一并搬移,保证搬后 features 不反向依赖 panels。

### 2. image_gen 四引擎混杂(在途,勿动)

> 08-31 晚更新:分离已在工作树基本落地(pipeline 1083→113 行/model_cache 687→201/download_model 342→117,`engines/` 四文件已接线),待 owner 任务(`08-31-engine-separation`)提交合并;盘点详见 `.trellis/tasks/08-31-arch-coupling-governance/research/engine-separation-status.md`。

`engines/`(krea2/flux2/z_image/qwen)已建但 pipeline.py 仍内嵌全部引擎代码、未 import engines——分离工作正在进行(工作区 `adapter.py`/`server.py` 已改,`engines/` untracked)。本报告不抢跑,治疗以 08-31-engine-separation 任务为准。

### 3. model_cache.py 九包复制粘贴(2026-08-31 晚已部分治疗)

- **已落地**:`apps/backend/model_cache_core.py` 双族共享核(HF blob/snapshot 族+平铺单文件 sha256 pin 族);tts/depth_estimation/upscale/video_qc 四包薄封装化(对外签名不变);`video_use/alignment.py` 改指 core,**`video_use → tts` 跨包边消失**。
- **验证**:env 行为对拍 13/13 场景一致(`apps/build/scripts/model_cache_env_parity.py`,子进程隔离 HOME+env+伪造缓存夹具);关联面 83 测试绿;独立子代理审查 6/6 项通过并修掉 `allow_empty_pin` 死参数 bug(修前空 pin 语义与 upscale 原实现相反,修后定向五例验证)。
- **待合并窗口**:audio_gen/music3_gen/sfx_gen 三包仍在途被并行会话修改,合并后按同一轨道转换;image_gen 走 engines/ thin dispatcher 不接核;vlm_review 属平铺目录异族不动。
- 复测:≥5 包同名重复函数 6→4(剩余=三在途包真实现+四薄封装的同名一行转调)。

### 4. electron main.ts 巨石

1885 行、109 条 import、0 处 ipcMain.handle(handle 已下沉到 `electron/ipc/` ✅)。剩余职责=窗口生命周期+子进程编排+运行时装配。拆分方向:按 runtime/窗口/生命周期分模块装配。需单独立项(IPC 白名单+smoke 均引用启动行为)。

### 5. 其余低危

- `layer_separation/separator.py → depth_estimation.adapter`:分层分离复用深度估计适配器,合理复用但方向反了(应下沉共享 adapter);量小,暂报不动。
- `video_use/alignment.py → tts.model_cache`:同上,复用 TTS 缓存探测。
- `panels/(root) SettingsPanel.tsx → panels/settings/*` 10 处:SettingsPanel 是 settings 域的组合根却住在 panels 根;搬进 `panels/settings/` 即消,但 smoke/构建断言引用该路径,收益低风险面广,暂报不动。
- `panels/sclass/sclass-scenes.tsx` 47 imports、`panels/director/split-scenes.tsx` 44 imports:巨石组件,随 #1 治疗后再评。
- `sys.path` hack 仅 2 处测试/脚本文件,可接受。

## 治疗执行记录(#1)

见文末「执行结果」;搬移清单与 import 重写由脚本 `apps/build/scripts/sclass_director_extraction.py` 生成执行(确定性文件搬移,非符号重构,故未走 gitnexus rename)。

## 执行结果(2026-08-31 已完成)

### 大文件瘦身 P1(尺寸裁定落地:HARD 38→32)

七笔提交:deletion 998→4 / projection 1133→5 / hyperframes 1270→6 / image-generator 1242→5 / inventory 1055→4 / composition-props 1277→5(纯再导出门面)/ tts-runtime 1630→1142+490(工厂留专批)。全部体逐字搬移+门面再导出保 import 面;每件 typecheck+域测试绿(30/161/29/421/60/137/99)。通用配方 `ts_line_splitter.py`。剩余 32 个 HARD=P2 panels 域+P3 在途(main.ts 归 main-split 子任务)+tts 工厂专批。

### 治疗 #1:sclass↔director 共享分镜域抽取 ✅

- **搬移**:`panels/director/` → `components/features/storyboard/` 共 **53 文件**(26 个被 sclass 直接引用的种子模块 + 5 个 director 内传递闭包模块[character-selector / editable-text-field / media-library-selector / scene-library-selector / storyboard-reference-utils] + 22 个配套测试),`git mv` 保留历史。
- **重写**:44 个文件的 import 统一改 `@/components/features/storyboard/<模块>`;工具:`apps/build/scripts/sclass_director_extraction.py`(两阶段:干跑清单→`--apply` 执行)+ `sclass_extraction_rewrite_repair.py`(幂等补写,含残留断言)。
- **同修**:`design-lint-whitelist.json` 两条 R5 白名单路径跟进(media-library-selector、storyboard-scene-frame-section)。
- **验证**:typecheck 全绿;director+sclass+features/storyboard 三域 **61 文件/178 测试全过**;component-ownership + design-lint-gate 13 测试全过;全仓旧路径引用扫描零残留;体检脚本复跑确认 sclass→director 边消除(跨域边 8→7)、分层违规保持 0。
- **效果**:director 域(74 文件)瘦身至可独立演进;features 层从 14 文件长成 67 文件的共享分镜生产域;sclass 不再穿透面板边界反向依赖 director。

### 过程坑(在档)

1. `vi.mock("./x")` 不是 import 语句,import 正则看不见;且全文件级引号配对正则会被前文撇号错位吞掉跨行区域——逐行配对才稳。
2. vitest 必须带 `--config frontend/config/vite.config.ts` 调用(别名在配置里),裸 `pnpm vitest` 会以零别名跑出大面积假红(41 文件 transform 失败假象)。
3. 搬移执行中发现并行会话同一时段在跑打包链(electron-builder 19:53 起);本次改动域(director/sclass/features/build-scripts/docs)与其在途域(backend image_gen + panels/settings·music·studio + electron rendering)零交集,未冲突。

### 未提交声明

工作区含并行会话 80 个在途文件(+1808/-1870),本次改动**不提交**,与并行工作隔离;待并行任务收口后一并入库。
