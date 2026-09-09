# 后端(apps/backend)三域分层——engines 独立抽离裁定与目录规划

日期:2026-09-09。裁定:用户——「engines 不止这个 image 概念,应该单独抽出来;文本/生图/音乐/声音/视频都是与 engines 概念有区别的另一类」。方法论:照 GitHub 高星项目的现成分层,不自创(铁律3 高星参考)。

**落地状态(09-09)**:P1 引擎域搬家=`3fadf6f`+`357cfac`(纯 git mv+import 绝对化);P2 `image_gen/engines`→`providers` 改名=`ba94435`;全量后端 387/0 前后一致,TS spawn 面零变化。P3(common/ 归拢+九包 model_cache 合并)另立任务未动。spec 同步:`.trellis/spec/backend/directory-structure.md` 已按三域改写。

**何时读**:动 `apps/backend` 目录结构、新增后端包、新增/接入引擎、给 ComfyUI 写自定义节点之前必读。

## 一、三域分层(概念裁定)

后端 Python 包分三域,互不嵌套、概念不混:

| 域 | 概念定义 | 现有成员 | 边界纪律 |
|---|---|---|---|
| **engines/**(托管引擎域) | 重型运行时**实例**的下载/安装/更新链/启动/守卫/端口/插件策展 | ComfyUI 自管实例(唯一) | 只管引擎生命周期,零业务生成逻辑;模态代码永不 import 引擎代码(既有裁定2:引擎=独立进程+独立 venv,交互面只有 subprocess git/pip + HTTP) |
| **模态服务包**(一个模态一个包) | 进程边界:`server/main`=常驻 HTTP sidecar,`worker`=一次性进程 | 13 包见五族表 | 每包自治(spec/下载/缓存/执行);调引擎走 HTTP,不反客为主 |
| **common/**(共享基建,渐进归拢) | 零业务语义的复用件:模型缓存/下载器/job 进度/端口段 | model_cache_core.py、modelscope_hub.py(现散顶层) | 只放被 ≥2 域共用的;宁缺勿滥 |

**同一引擎可以服务多模态**(ComfyUI 原生跑图/视频/音频图)——这就是「engines 不止 image」的根据;反过来,**模态包也未必用引擎**(tts/music3/video 走自家管线,PRD 已裁定不进 ComfyUI)。两个概念正交,谁也不该是谁的子目录。

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
  engines/                        # 域1:托管引擎(独立抽离裁定)
    __init__.py
    comfyui/                      # ComfyUI 引擎适配器(现唯一;第二引擎平级入驻,照 jan extensions/)
      __init__.py
      manifest.py                 # ← image_gen/comfy_manifest.py(实例目录单源,覆写感知)
      engine_manager.py           # ← image_gen/engine_manager.py(安装/更新链/launch/守卫/端口)
      plugin_manager.py           # ← image_gen/plugin_manager.py(插件安装/差分/策展)
      execute.py                  # ← image_gen/comfy_execute.py(子图执行,经引擎 HTTP)
      curated_plugins.json        # ← image_gen/curated_plugins.json(策展清单,照 LocalAI gallery 独立成件)
      manying_nodes/              # 自研自定义节点包源码位(见 09-09 任务 design.md 2.1)
        __init__.py  nodes/  bridge/  tests/
      tests/                      # ← image_gen/tests/test_comfy_*.py(随组件同目录铁律)
  # ── 域2:模态服务包(平级不动;五族归属见上表)──
  image_gen/                      # 生图 sidecar
    providers/                    # ← engines/ 改名消歧(见命名裁定)
      krea2.py  flux2.py  z_image.py  qwen.py  comfyui_bridge.py
    server.py  main.py  pipeline.py  uncloth_pipeline.py
    download_model.py  model_cache.py  model_inventory.py
    workflows/  tests/
  tts/  audio_gen/  sfx_gen/  music3_gen/
  video_use/  video_qc/  upscale/  layer_separation/  depth_estimation/  vlm_review/
  # ── 域3:共享基建(渐进)──
  common/                         # model_cache_core.py + modelscope_hub.py 归拢位(P3)
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
| **P1 engines 抽离** | git mv 五件套(comfy_manifest→manifest、engine_manager、plugin_manager、comfy_execute→execute、curated_plugins)+ image_gen/tests/test_comfy_*.py → engines/comfyui/(+tests/) | 仅 Python 内部 import:comfy_execute/plugin_manager/comfyui_bridge 互引 + server.py 懒加载 + ~8 个测试文件;**TS spawn 面零变化**(spawn 只引 image_gen.main/model_inventory/download_model);/comfy/* 路由留在 image_gen server.py,handler 改 import |
| **P2 providers 改名** | image_gen/engines/ → image_gen/providers/ | 内部 import(model_cache/model_inventory/pipeline/server/download_model/uncloth_pipeline/scripts)+ 测试;TS 零变化 |
| **P3(另立任务,不抢跑)** | common/ 归拢 model_cache_core+modelscope_hub;九包 model_cache/model_inventory/download_model 重复渐进合并(memory 既有「待合并窗口」);engine_manager 1150 行是否照 Comfy Desktop 分法拆 installer/launcher | 届时单独盘点 |

## 五、坑表

- **PYTHONPATH 与打包都不用动**:`PYTHONPATH=apps/backend`(打包后 Resources/backend)指向根,engines/ 顶层包天然可见;build-mac.sh 平铺拷贝是路径无关的。
- **P0a 未提交期间禁止搬家**(审读地狱+rename 检测失效);搬家用 git mv,同批不带逻辑变更。
- **comfyui_bridge 归属**:它是 providers 的一员(生图经引擎执行),不是引擎域成员——引擎域只管生命周期,不含任何生成路径。
- **引擎专属 sidecar 留门不裁**:现在引擎生命周期经 17595 image sidecar 暴露;若未来非生图模态也要驱动引擎,可另立 engines sidecar——门留着,本期不开。
- **README 目录段已按三域重写**(apps/backend/README.md);新增后端包时同步该表与本文五族归属表。
