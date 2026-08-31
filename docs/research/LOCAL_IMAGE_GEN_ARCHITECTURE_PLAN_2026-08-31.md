# 本地生图架构深读与路线计划（自研 sidecar vs ComfyUI）· 2026-08-31

> 状态：**待用户审阅拍板**。本文只做深度探索与规划，未动任何代码。
> 探索方法：后端核心逐文件精读（pipeline/model_cache/adapter/server/worker/inventory/engines）+ 前端集成面与本机 ComfyUI 实况各一路子代理实测 + 应用模型缓存实地核查。文中行号以 08-31 晚工作树为准。

---

## 0. 一页结论

1. **生产主力 T2I 继续走自研 sidecar**——维持上轮判断。四引擎、51 个后端测试、typed 就绪口径、装机链全部成熟，全面迁移 ComfyUI（方案 C）只会失去这些。
2. **一个升级判断**：参考图编辑（分镜一致性的核心能力）在自研路线上是代码里明确标注的「二期大坑」（diffusers 0.40 的 Krea2Pipeline 无 image 参，`pipeline.py:856-857`），而本机 ComfyUI 是**每天在用的活跃服务**（跑在 **8000 端口**，非 8188；今晚 19:19 仍有日志），Krea2 编辑生态现成：krea2edit 自定义节点、identity_edit LoRA（1.7G，就在 models/loras/Krea2-编辑/）、NSFW 专业流工作流 JSON。→ 建议新增**「ComfyUI 桥引擎」作为参考图编辑/NSFW 专业流的专用通道**，连已运行的服务、不再起新实例（方案 B）。
3. **当下真实状态：四引擎只有 Krea2 就绪**。ComfyUI models 目录 8/22 被换血，Qwen/Z-Image/FLUX.2 的大件全部不在（应用缓存实测也无 GGUF 自足回退）。「指向 ComfyUI」的单点依赖已被证伪一次，三引擎处置需要拍板（D3）。
4. **MCP 结论不变**：生产链路不引入 MCP（agent 协议加一层零收益）；MCP 只在开发期辅助试验工作流时有意义。
5. 深读揪出一批与架构无关的**硬刺**（默认引擎静默丢参考图、krea2 被标成文本模型、连续性门禁锁死本地引擎、引擎选择四层漂移），建议 Phase 0 先止血，不必等大方案拍板。

---

## 1. 深读事实

### 1.1 后端 sidecar（`apps/backend/image_gen/`，约 3500 行 Python）

| 文件 | 行数 | 职责 |
|---|---|---|
| `pipeline.py` | 1083 | 四引擎装配+生成分派；单飞互斥；ComfyUI 权重直载与键名转换 |
| `model_cache.py` | 687 | 引擎目录（IMAGE_MODELS）、大件两源解析、小件完备性 |
| `download_model.py` | 342 | CLI 下载（UI 实际在用的那条轨） |
| `server.py` | 293 | HTTP sidecar：127.0.0.1:17595，OpenAI images API 兼容，固定本地 token |
| `adapter.py` | 270 | typed 文件边界（仅 worker CLI 消费，**前端从不走**） |
| `worker.py` | 88 | JSON 文件 CLI（--probe/--run） |
| `model_inventory.py` | 83 | 离线盘点（/models/status 数据源） |
| `engines/` | ~900 | **在途重构**（见 1.4） |

关键机制（均已测试钉住）：

- **四引擎按 layout 分派**（`pipeline.py:969-1027`）：krea2-pointed（主力，8 步蒸馏）/ flux2-pointed（原生 image 输入编辑）/ z-image-pointed（img2img strength=0.35 实弹标定）/ qwen-pointed（编辑管线语义，参考图=画布底图）。
- **推理互斥单飞**：非阻塞抢锁，忙时 `generation-busy` 409，不排队（`pipeline.py:80-95`，实弹双请求死锁教训）。
- **ComfyUI 权重生态直载**：Qwen2.5-VL TE 键名映射（`pipeline.py:103-128`）、Krea2 430 键转换器严格校验（`pipeline.py:590-652`）、ComfyUI 格式 LoRA 手动合并免 PEFT（`pipeline.py:655-697`）、heretic TE 前缀重映射回退（`pipeline.py:819-829`，RGB 伪影根因修复）。
- **fail-closed 纪律**：推理绝不自动下载；缺大件/缺小件/缺依赖各自有可操作错误码。
- **NSFW LoRA 默认关**（f301ec5 深审 A/B：对非 NSFW 人物有面部模糊/色彩污染副作用）；`_generate_krea2(use_lora=...)` 参数在分派处目前硬编码 False（`pipeline.py:998`），前端 extraParams 通路未接通。
- 测试 51 个：server 1 + worker 14 + qwen 36（覆盖两源优先级、fail-closed、mediaRoot 逃逸含 symlink、busy、键名映射、下载分档）。

### 1.2 前端/主进程集成面

- **生命周期**：`image-gen-runtime-controller.ts`（434 行）spawn `python -m image_gen.main` → `/health` 轮询 30s 上限 → 退出时 kill。**spawn env 只注入 `PYTHONPATH` + `MYSTUDIO_IMAGE_MODEL_DIR`**（`:115-122`）；`MYSTUDIO_*_COMFYUI_MODELS_DIR` 全前端零注入，后端默认硬编码 `~/Project/ComfyUI/models`（`model_cache.py:291-294`）。
- **Provider 同构（最大优点）**：`manying-local-image` 注册为普通 image_generation provider（`api-config-provider-helpers.ts:59-78`），与云端走同一抽象。三入口（分镜批量/自由生图/资产生成）全部汇到 `POST /v1/images/generations`。
- **IPC 9 通道**：probe/prepare/rollback/status/setup/stop/scan-model/download-model/set-active-model（`image-gen-ipc.ts`）。
- **下载链双轨**：UI 实际走 CLI 子进程+进度文件轮询（`controller:281-313`）；sidecar 的 `/models/download`+`/models/progress-json` 闲置。
- **后处理钩子四件对本地/云零分支**：saveImage 落库、自动降噪（370a35f）、VLM 审核重生循环、超分 up4x——同构性已验证，新引擎（含桥）自动继承。
- **就绪口径**：模型在即就绪（用户裁定 08-29），`lifecycleStatus()` 注释明说与服务运行无关（`controller:373-380`）；b347ea1 的「大件已删自动回退」只改内存不持久化（`:358-371`）。

### 1.3 本机 ComfyUI 实况（子代理实测）

- **一套活跃安装**（非沉睡）：ComfyUI Desktop，数据目录 `~/Project/ComfyUI`（整目录 ~101G，`.venv` 2.3G / torch 2.13 / Python 3.12），代码仓 v0.33.0 干净无本地补丁，**端口 8000**，`Device: mps`，128G 统一内存。**今天全天多次启动，19:19 仍有日志；output 今天有 Krea2 出图与 H3 视频**。
- **models 现状（99G，8/22 换血后）**：
  - 在：Krea2 全家桶（24G 主模型 + 8.3G heretic TE + 242M VAE + NSFW LoRA×4 + **identity_edit_v1_2.safetensors 1.7G**）；MiniMax-H3 视频全家桶（37G 主模型 + 14G TE + 双 VAE + SeedVR2 3B + RIFE + 潜空间放大）。
  - **不在**：Qwen GGUF/TE、Z-Image、FLUX.2 全部大件、upscale anime、一切 controlnet。应用缓存（`~/Library/Application Support/漫影工作室/model/imagegen`）五个仓小件齐全但**无任何 GGUF 大件**。
- **custom_nodes 26 个**：comfyui-krea2edit、ComfyUI-Krea2T-Enhancer、ConditioningKrea2Rebalance、GGUF、Easy-Use、rgthree 等；2 个当前导入失败（LayerStyle、LTXVideo）。
- **24 个现成工作流**：`K2图像/` 6 个（含 NSFW 专业流、文生图简版）、`H3视频/` 14 个（含官方 API 格式版）。
- **仓库内零 ComfyUI API 调用代码**（8188//prompt//history/websocket 全无命中）；唯一先例是历史草案 `docs/融合/模板系统与ComfyUI集成方案.md`（2026-05，文首已标注不改变现行主链）。

### 1.4 在途工作（本计划必须避让）

- **并行会话正在做 engines/ 每引擎一模块重构**（08-31 用户裁定「每个模型自己一个脚本」；`engines/qwen.py` 今晚 19:38 刚创建；`engines/__init__.py` 声明 model_cache/pipeline 只做注册表+分派）。当前 pipeline.py 仍是活实现、无任何文件 import engines——重构在半途。**本计划所有后端改动排在它合拢之后或与之协调。**
- adapter.py/server.py 有未提交改动（四引擎小件探测/status 统一/Qwen 缺啥下啥），是该重构的前置打磨。

---

## 2. 关键发现（风险 R / 机会 O）

- **R1 四引擎只有 Krea2 就绪**。Qwen/Z/FLUX.2 大件被删且无自足回退（Z/FLUX.2/Krea2 本就无自足仓，Qwen 的 app-cache 回退也没下过大件）。恢复成本：37G/13.7G/35G 重下，或用户自放文件。
- **R2 「指向 ComfyUI」的单点依赖已被证伪一次**：用户按自己需要换血 models 目录 = 应用就绪态的外部变量（b347ea1/80ef545 就是事后补救）。
- **R3 默认引擎静默丢弃参考图**：`_generate_krea2` 收了 `reference_image_b64` 参数但函数体从不使用（`pipeline.py:853` vs `:872-883`）。分镜流黄金公式自动装配的 1+3=4 张参考图，对当前默认引擎**全部无效且无任何警告**。
- **R4 参考图链路三处断裂叠加 = 本地事实上 T2I-only**：① 前端连续性门禁只认 gpt-image（`lib/studio/image-workflow/request.ts:176-184`），本地四引擎带 versionId 参考直接被拒；② sidecar 只吃 `image_urls[0]`（`server.py:192-198`），第 2 张起白传；③ Krea2 无编辑能力（R3）。
- **R5 双入口契约分裂**：UI 真实走 server.py（五档 aspect_ratio）；adapter/worker CLI 路径钉死 1920x1080 且拒绝参考图，但**前端从不 spawn worker**——死契约有误导性（谁按 contract 接 worker，aspect ratio 立刻塌回 letterbox）。
- **R6 引擎选择四层漂移**：sidecar 缺 model 默认 Qwen（`server.py:167`）/ controller 配置缺失默认 FLUX.2（`controller:93`）/ provider 常量主力 krea2-turbo（`helpers:64`）/ 真正话事的 featureBindings 与设置页「设为当前」互不联动；回退不持久化。
- **R7 小刺**：krea2-turbo 被 `classifyModelByName` 归为 text（`model-capabilities.ts:20-38` 无 pattern）；17595 端口无争用仲裁（`controller:211-215` 显式丢弃探测结果）；下载双轨；ComfyUI 目录零配置面（UI 只读展示 pointedFiles，env 都不注入）。
- **O8 ComfyUI 是被低估的活跃资产**：参考图编辑生态现成（节点+LoRA+工作流三样齐）+服务每天在跑+8000 端口可连——这是桥方案成立的地基。顺带发现 **H3 视频全家桶**也在（与 08-22 自研 H3 GGUF 链是两套资产，远期再议）。

---

## 3. 方案对比

| 维度 | A 全自研深耕 | **B 自研+桥混合（推荐）** | C 全面迁 ComfyUI | D MCP 层 |
|---|---|---|---|---|
| 参考图编辑 | 等 diffusers 支持或手搓模块化管线+identity LoRA 装配，周期不可控 | **桥直连现成 krea2edit 生态，多参考真正生效** | 同 B | 同 C 但多一层协议 |
| NSFW 专业流 | LoRA 合并机器已有，但编辑流没有 | **现成工作流 JSON 可直接改造成模板** | 同左 | — |
| 可控/可测 | 51 测试+typed 边界，最强 | T2I 链不变；桥为增量引擎独立可测 | workflow JSON 契约脆弱，节点版本漂移静默坏 | 最弱 |
| 打包自足 | 最强（不依赖外部进程） | T2I 自足；桥引擎明示依赖本机 ComfyUI | 需要 ComfyUI 常驻或外置，装机负担 | 同 C |
| 与「就绪=模型在」裁定 | 完全兼容 | 桥引擎需特例口径（服务在跑才就绪），作可选专业引擎+明确文案 | **全面冲突，需推翻裁定** | 同 C |
| 维护成本 | 新引擎=130-350 行/个，但编辑管线是研究型工作 | 桥客户端一次性+模板版本化 | 进程监督+节点管理+契约漂移，长期更贵 | C 之上再加协议层 |

**D（MCP）单独结论**：MCP 是给 LLM agent 调工具的协议，生产运行时引入 = 凭空一跳，纯减分，不推荐。它的正确位置是开发期辅助（我在试验新工作流时用），不属于应用架构。

---

## 4. 推荐路线：方案 B，分四阶段

### Phase 0 · 止血小修（不动架构，独立小提交，可先行）

| # | 内容 | 落点 | 备注 |
|---|---|---|---|
| P0-1 | Krea2 收到参考图即 fail-closed：「Krea2 暂不支持参考图，请切换 FLUX.2/Qwen 或云端引擎」（消灭静默丢弃） | `engines/krea2.py`（与并行重构协调，排在其后） | 加 fail-closed 测试 |
| P0-2 | `classifyModelByName` 补 krea2 pattern（修「文本模型」错标） | `model-capabilities.ts` | 一行+测试 |
| P0-3 | 引擎默认值统一：三处默认收敛到 krea2-turbo，回退持久化 | server/controller/ipc legacy 路径 | 可选拆二期 |
| P0-4 | NSFW LoRA 的 use_lora 通路接通（extraParams→透传）或删参数明示不可用 | 分派处 | 用户裁定默认关不变，只接显式开 |
| P0-5 | 死契约处置：worker CLI+1920x1080 钉死，删除或标 legacy | 契约/adapter | 拍板 D6 |

验收：现有 51 后端测试+新增测试全绿；typecheck/lint；无需打包（或随下一批一起）。

### Phase 1 · 参考图编辑能力落地（核心增量，**先拍板 D1/D2**）

推荐主案 **1b ComfyUI 桥引擎**：

- 新增第五引擎（如 `comfyui-bridge`），按现有 provider 注册方式并列（展示层遵守「按功能模块分组+标签」铁律）。
- 客户端四件事：**端口发现（默认 8000，可配置——勿硬编码 8188）**→ 健康检查（`/system_stats`）→ 工作流模板（拿 `K2-文生图-简版.json`/`Krea2-NSFW专业流.json`/krea2edit 模板改造，**仓内置+版本化**，不依赖用户目录）→ `POST /prompt` + `/history` 轮询（或 /ws）+ `/view` 取图。
- 参考图全量进模板 LoadImage 节点——多参考、上一镜成图、identity 编辑真正生效，这是本方案的核心收益。
- VLM 审核/降噪/超分钩子自动继承（同构性已验证，零额外接线）。
- 就绪口径特例：桥=「ComfyUI 在跑才就绪」，文案大白话（如「需要 ComfyUI 正在运行」）；不污染四引擎的既有口径。
- 避让：绕开当前导入失败的两个节点（LayerStyle/LTXVideo）；模板不依赖 SolAttn 启动旗标。

备选 **1a 全自研 Krea2 编辑**：复用 LoRA 手动合并机器装配 identity_edit_v1_2 + 研究 diffusers 模块化管线。研究型、周期不可控，作为桥的远期替代保留（若拍板走 1a，本阶段内容等价替换）。

变体 **1c 桥走 MCP（拍板 D8=B2 时）**：先建应用内 MCP 宿主（Electron 主进程 + `@modelcontextprotocol/sdk`，stdio/Streamable HTTP 双 transport，渲染层 IPC 暴露，设置页「MCP 服务器」区块），桥改为 MCP 客户端连 ComfyUI MCP server（显式配 8000 端口）。多一层协议与社区 server 质量风险，换「一个宿主接 N 个工具」的平台化扩展性；未来 agent 修复流（LLM 自主选工具）可直接复用同一宿主。B1 直连与 1c 可后期互换（provider 抽象隔离传输层）。

### Phase 2 · 引擎盘整顿（拍板 D3）

- Z/FLUX.2/Qwen 三引擎现状=需准备。选项：a) 自足化大件下载（Qwen 先例配方可复制，ModelScope 优先）b) 维持「用户自放才可用」+文案明示（**推荐**，实际需要时再自足化）c) 退役收敛。
- 顺带小项：ComfyUI 目录设置页可配置（输入框+spawn env 注入）；下载双轨合一；端口争用提示文案。

### Phase 3 · 远期（另行立项，不在本计划范围）

- MiniMax-H3 视频侧 ComfyUI 桥评估（models 里 37G 全家桶+14 工作流 vs 自研 H3 GGUF 链，两套资产的取舍）。
- RunningHub 云端 ComfyUI（历史草案翻新，另一维度）。

---

## 5. 测试与验收策略

- **桥客户端单测**：mock `/prompt`、`/history`、`/view`；fail-closed（服务不在/节点缺失/超时/端口错）全覆盖。
- **模板治理**：模板文件带 schemaVersion，仓内测试钉住必需节点存在。
- **前端**：契约测试+设置页文案测试（遵守 UI 大白话铁律：不说 workflow/prompt JSON 这类词）。
- **实弹验收**：装机 smoke（build-mac.sh 唯一入口）+ 出图对拍（桥 vs 自研同 prompt 各出 N 张，以 VLM 审核通过率与肉眼可用性为准——两引擎同 seed 也不可比，不做像素对拍）。
- 全门禁绿基线后才算交付（当前基线 4320+，随并行会话推进以最新为准）。

## 6. 风险与回滚

- **桥依赖外部进程**：断连/ComfyUI 升级换版导致模板漂移 → 模板版本化+fail-closed 大白话报错；桥是独立引擎，整体下线不影响四引擎。
- **与并行 engines/ 重构撞车** → Phase 0 后端项全部排在重构合拢后；本计划不新增后端文件级改动直到确认。
- **内存争用**：ComfyUI(8000) 与自研 sidecar 并存 128G 可承受；H3 视频任务在跑时生图需提示文案。
- **回滚**：桥=provider 列表移除即回滚；Phase 0 各项独立小提交可单独 revert。

## 7. 待拍板决策点

| # | 决策 | 选项与推荐 |
|---|---|---|
| D1 | 总路线 | **B 自研+桥混合（推荐）** / A 全自研 / C 全迁 |
| D2 | 桥形态 | **连已运行的 8000 实例（推荐）** / 应用自管 ComfyUI 进程（重，不推荐）/ 暂不做桥 |
| D3 | 三引擎处置 | **维持「用户自放才可用」+文案（推荐）** / 自足化下载 / 退役 |
| D4 | 连续性门禁对本地引擎 | 降级为警告+首图语义 / **保持拒绝但文案指路（推荐，Phase 1 桥上线后再开）** |
| D5 | NSFW 显式开关 UI | 本批做 / 随 Phase 1 桥一起 |
| D6 | worker CLI 死路径 | **删除（推荐）** / 标 legacy 保留 |
| D7 | Phase 0 是否先行 | **先行（推荐）** / 等总路线一起拍 |
| D8 | 应用内 MCP 宿主（运行时） | **B1 先直连 REST、MCP host 独立后置（推荐）** / B2 先做 MCP host、桥从第一天走 ComfyUI MCP server / 暂不做 |

> D8 补充（08-31 讨论增补）：MCP 进应用运行时是否划算，取决于「运行时谁决定调哪个工具」——固定代码决定的管线直连 REST 最短；应用内 LLM 自主选工具的 agent 流才是 MCP 主场（如 VLM 审核重生循环进化为自主修复代理）。若做：MCP 宿主放 Electron 主进程（`@modelcontextprotocol/sdk`，stdio+Streamable HTTP 双 transport），渲染进程走 IPC；设置页加「MCP 服务器」区块；stdio server=用户自配任意代码，需 security-review 过一遍。桥坐 provider 抽象后面，REST↔MCP 传输后期互换不返工。

---

## 附：证据索引（关键条目）

- Krea2 丢参考图：`apps/backend/image_gen/pipeline.py:853`（收参）vs `:872-883`（未用）；透传点 `server.py:200-208`。
- 只吃首图：`apps/backend/image_gen/server.py:192-198`；前端全量发送：`apps/frontend/lib/ai/ai-sdk-bridge.ts:305,319`。
- 连续性门禁：`apps/frontend/lib/studio/image-workflow/request.ts:176-184`。
- 引擎默认三处不一：`server.py:167` / `image-gen-runtime-controller.ts:93` / `api-config-provider-helpers.ts:64`。
- 就绪口径与回退：`image-gen-runtime-controller.ts:347-380`。
- ComfyUI 实况：`~/Project/ComfyUI/config.json`（installState/basePath/hasGeneratedSuccessfully）、代码仓 `comfyui_version.py`=0.33.0、日志端口 8000、`user/default/workflows/`（K2图像 6 个/H3视频 14 个）。
- 应用缓存实测（08-31 晚）：`~/Library/Application Support/漫影工作室/model/imagegen/` 五仓小件在、无 GGUF 大件。
- 历史草案：`docs/融合/模板系统与ComfyUI集成方案.md`（2026-05，明确标注为历史候选设计）。
