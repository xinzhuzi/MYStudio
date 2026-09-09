# 后端(apps/backend)三域分层——engines 独立抽离裁定与目录规划

日期:2026-09-09。裁定:用户——「engines 不止这个 image 概念,应该单独抽出来;文本/生图/音乐/声音/视频都是与 engines 概念有区别的另一类」。方法论:照 GitHub 高星项目的现成分层,不自创(铁律3 高星参考)。

**落地状态(09-09 终态)**:引擎层统一全部完成——P1/P2 comfyui 搬家+providers 改名=`3fadf6f`+`357cfac`+`ba94435`;P-tts tts_engine=`b893b29`;P4 批A worker 型四引擎(upscale/video_qc/vlm/depth)、批B image_engine、批C/D audio/sfx 拆分+music3 权重件=`(批A..批D 提交,见 git log engines 关键词)`。全量后端 387/0 全程一致;spawn 面逐条不变;env 契约不变。spec:`.trellis/spec/backend/directory-structure.md`。

**何时读**:动 `apps/backend` 目录结构、新增后端包、新增/接入引擎、给 ComfyUI 写自定义节点之前必读。

## 一、三域分层(概念裁定)

后端 Python 包分三域,互不嵌套、概念不混:

| 域 | 概念定义 | 现有成员 | 边界纪律 |
|---|---|---|---|
| **engines/**(底层引擎域) | 模型引擎底层,**两种形态**:①**进程内推理引擎**——模型目录+权重发现/下载+加载+推理;②**托管实例引擎**——外部进程实例的安装/更新链/launch/守卫/端口/插件策展 | ①tts_engine(Kokoro/Qwen3-TTS/whisper)②comfyui(ComfyUI 自管实例) | 引擎包=纯模型域:零 HTTP、零 sqlite、零路由、零业务编排(照 Piper `src/python_run/piper/` 纯引擎包先例);服务包向下调用,反向依赖禁止;托管实例形态另有红线:引擎进程永不 import 进 sidecar(裁定2,交互面=subprocess git/pip+HTTP) |
| **模态服务包**(一个模态一个包) | 进程边界:`server/main`=常驻 HTTP sidecar,`worker`=一次性进程 | 13 包见五族表 | 每包只留服务面(HTTP/存储/编排/状态视图),模型底层调 engines/;调托管引擎走 HTTP |
| **common/**(共享基建,渐进归拢) | 零业务语义的复用件:模型缓存骨架/下载器/job 进度/端口段 | model_cache_core.py、modelscope_hub.py(现散顶层) | 只放被 ≥2 域共用的;宁缺勿滥 |

**「engines 不止 image」的两层含义**(09-09 两次裁定,第二次修正了第一次的狭义解读):①同一引擎可服务多模态(ComfyUI 原生跑图/视频/音频图);②**每个模态自己的模型加载/推理底层也是引擎**,统一住 engines/(tts_engine 首例,09-09 `b893b29`)。模态服务包(tts/、image_gen/…)=HTTP/存储/编排的上层,不是引擎本身。

### 模态五族归属表(用户口径:文本/生图/音乐/声音/视频)

| 族 | 包 | 备注 |
|---|---|---|
| 文本 | vlm_review | 本地 VLM 审计;云端 LLM 走 TS 供应商层,无 sidecar |
| 生图 | image_gen(主);后处理:upscale(超分)/layer_separation(分层)/depth_estimation(深度) | image_gen 是唯一走 ComfyUI 引擎的模态 |
| 声音 | tts(语音+克隆+STT)/audio_gen/sfx_gen(音效) | tts 独立 venv 纪律见 backend README |
| 音乐 | music3_gen | MLX 侧车,永不混淆 |
| 视频 | video_use(剪辑链)/video_qc(DOVER QC) | remotion 渲染器在 TS 侧 |

## 二、GitHub 高星参照(借的是「域的划分方式」,零代码拷贝)

| 项目(星级约) | 结构证据 | 借什么 |
|---|---|---|
| **Comfy-Org/desktop**(ComfyUI 官方桌面壳) | `src/install/`(installationManager/installWizard/resourcePaths)、`src/virtualEnvironment.ts`、`src/main-process/comfyServer.ts`、`src/config/`(comfyConfigManager/comfySettings) | 引擎生命周期整体独立成域——官方自己就没把它放进任何能力模块;install 与 server 管理分文件 |
| **janhq/jan**(~48k) | `extensions/llamacpp-extension`、`extensions/mlx-extension`;`src-tauri/plugins/tauri-plugin-{llamacpp,mlx}` | 引擎=平级插件包+统一生命周期接口;新增引擎=新包平级入驻,不改核心 |
| **mudler/LocalAI**(~35k) | `backend/{cpp,go,python,rust}`(引擎运行时)、`core/`(应用+http+gallery)、`pkg/`(共享库:downloader/model/vram) | 三域同构:engines↔backend/、模态服务面↔core/http、common↔pkg/、模型目录↔gallery(策展清单独立) |
| **open-webui/open-webui**(~100k) | `backend/open_webui/routers/{audio,images,…}.py` 按模态分路由;`utils/images/comfyui.py` 把 ComfyUI 当生图 provider 适配 | 模态=服务面在前,引擎在模态后面当 provider;引擎管理不占模态的位置 |
| **comfyanonymous/ComfyUI**(~82k) | `comfy/`(执行内核)与 `nodes/`/`comfy_api_nodes/`/`custom_nodes/`(能力实现)彻底分离 | 「引擎≠模态」的原生证据;自定义节点=引擎插件(custom_node 包),不属于任何模态包 |

## 三、目标目录树

```
apps/backend/
  engines/                        # 域1:底层引擎层(10 包,两形态)
    tts_engine/                   # 进程内推理:engine/engine_config/engine_utils/tts/catalog/model_cache
    image_engine/                 # 进程内推理:krea2/flux2/z_image/qwen/comfyui_bridge
                                  #   +model_cache+workflows/(K2 四模板)
    audio_engine/  sfx_engine/    # 进程内推理:generate.py(自 worker 原样切片)+model_cache
    upscale_engine/               # adapter+rrdbnet+srvgg+model_cache
    vlm_engine/  depth_engine/    # adapter+model_cache
    video_qc_engine/              # dover_scoring+dover_mobile_arch+model_cache+DOVER_LICENSE
    music3_engine/                # 权重件(model_cache+install_mlxserv_weights;推理经 mlx-serve 留服务包)
    comfyui/                      # 托管实例:manifest/engine_manager/plugin_manager/execute
                                  #   +curated_plugins+manying_nodes(规划位)+tests/
  # ── 域2:模态服务包(纯服务面:HTTP/CLI/编排/存储)──
  tts/                            # server/main/routes/storage/runtime_state/model_inventory
  image_gen/                      # server/pipeline/uncloth_pipeline/model_inventory/download_model/scripts
  audio_gen/ sfx_gen/ music3_gen/ # worker(=CLI spawn 面)/download_model/model_inventory
  upscale/ video_qc/ vlm_review/ depth_estimation/  # 同上式样
  video_use/                      # 剪辑链(无模型加载,无引擎件)
  layer_separation/               # 算法层(骑 engines/depth_engine,无自有模型)
  # ── 域3:共享基建(common/ 已落)──
  common/                         # model_cache_core(缓存骨架,env_names 参数化)+modelscope_hub
  tests/  requirements.txt  README.md
```

### 命名裁定

1. **顶层 `engines/`(复数)=引擎域**;「engines」一词从此专属引擎概念,别处禁用。
2. **`image_gen/engines/` → `image_gen/providers/`**:那些是「每模型一脚本」的生图管线(08-31 裁定),不是引擎;providers=生图提供方(本地模型栈+引擎路由桥 comfyui_bridge),照 AI SDK/LobeChat/LibreChat 的 provider 抽象惯例。
3. **跨域 import 一律绝对导入**(`from engines.comfyui import engine_manager`):providers/ 到 engines/ 无公共父包,相对导入够不着;PYTHONPATH=backend 根,绝对导入天然可见。

## 四、分阶段搬动(渐进铁律:每阶段独立提交,git mv 保 rename 检测)

**P0(先决)**:P0a(存储位置配置器)落地提交。当前其未提交改动正压在 comfy_manifest/engine_manager/server 上——**绝不与搬家混提交**。

| 阶段 | 动作 | 影响面(已实盘盘点) |
|---|---|---|
| **P1/P2/P-tts(已落地)** | comfyui 搬家=`3fadf6f`+`357cfac`;providers 改名=`ba94435`;tts_engine=`b893b29` | 全量 387/0 一致;spawn 面零变化 |
| **P4 批A(已落地)** | worker 型四引擎纯搬家:upscale_engine/video_qc_engine/vlm_engine/depth_engine(adapter/dover_scoring+架构件+model_cache) | 同上;layer_separation 改指 depth_engine |
| **P4 批B(已落地)** | image_engine:五模型栈+model_cache+workflows/ 整体入域;前端两测试改模板 JSON 新位 | 同上;**分层债**:krea2×3+comfyui_bridge×1 懒读 image_gen.pipeline(取消标志/PipelineError)=暴露的历史反向依赖,懒加载绝对导入保行为,后续裁定是否把取消态下沉引擎侧 |
| **P4 批C/D(已落地)** | audio_engine/sfx_engine=generate.py 自 worker **原样切片**(函数边界:Error/_require/_sha256/generate_*);music3_engine=权重件平移 | 同上;generate.py 无测试覆盖处用导入冒烟补位 |
| **过堂结论(不再抽)** | layer_separation=算法层(骑 depth_engine,无自有模型);cinematic_grades=FFmpeg 预设非模型(留 depth_estimation,仓内零引用属遗留);video_use=剪辑链无模型加载;music3 推理经 mlx-serve 留服务包 | — |
| **P3 模型机制集中(已落地两步)** | 第一步:common/ 域落地,model_cache_core+modelscope_hub 归拢(git mv+11 文件改向);第二步:audio/sfx/music3 手写助手拷贝收缩为 core 委托(-119 行),家族侧只留目录表+env 表+完备性谓词。**门禁**:parity 场景 13→18(audio/sfx 各三景先锁基线再重构),18/18 全绿=08-31 基线以来全部搬迁逐字节保行为 | ⚠️ P4 各批当时漏跑 parity(违规补验);sys.modules 假模块拦截键必须随导入路径改(漏改=真实下载→测试网络假死) |
| **剩余(可选)** | image_engine/model_cache 含 provider 注册表粘合(IMAGE_MODELS/_ENGINE_BY_LAYOUT),独特设计不强行归一;download_model/model_inventory 九份 CLI=spawn 服务面,按分层留守模态包 | — |

## 五、坑表

- **PYTHONPATH 与打包都不用动**:`PYTHONPATH=apps/backend`(打包后 Resources/backend)指向根,engines/ 顶层包天然可见;build-mac.sh 平铺拷贝是路径无关的。
- **P0a 未提交期间禁止搬家**(审读地狱+rename 检测失效);搬家用 git mv,同批不带逻辑变更。
- **comfyui_bridge 归属**:已随 image_engine 入域(生图经引擎执行的路由 provider=引擎件)。
- **测试 mock.patch 的字符串路径随模块走**:搬模块后必 grep 引号内旧路径(tts.model_cache 5 处漏改即红,AttributeError 是信号)。
- **导入形态三件套都要核**:`from 包.模块 import` 点式 / `from 包 import 模块` from 式 / **多名字导入**(`from x import a, b` 前缀替换会把留守件误拖进新包——pipeline/model_inventory/worker 屡次中招);懒导入缩进逐处修,勿整批字符串替换。
- **spawn 面盘点必须含 `-c` 内联形态**:Electron 侧除 `["-m", "pkg.mod"]` 外还有 `["-c", "from pkg.mod import …"]` 内联代码(dover 删模型按钮曾因此断链);搬模块后 grep 两形态:`"-m", "` 与 `"-c", "from `。
- **拆分引擎用「原样切片」**:audio/sfx 的 generate.py 直接从 worker.py 按函数边界切文本,不重打字;切片件无测试覆盖时必须导入冒烟补位。
- **引擎专属 sidecar 留门不裁**:现在引擎生命周期经 17595 image sidecar 暴露;若未来非生图模态也要驱动引擎,可另立 engines sidecar——门留着,本期不开。
- **README 目录段已按三域重写**(apps/backend/README.md);新增后端包时同步该表与本文五族归属表。
