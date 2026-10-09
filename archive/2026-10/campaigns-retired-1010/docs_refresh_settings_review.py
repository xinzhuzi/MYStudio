"""Apply independently reviewed and source-checked settings documentation fixes."""
from docs_refresh_batch import ROOT, update
update('docs/settings/ADVANCED_OPTIONS_GUIDE.md', [
 ('本文说明 `设置 -> 高级选项` 当前提供的生成控制项。这里主要影响导演/分镜视频生成流程和批量视频生成行为。', '本文说明 `设置 -> 高级选项` 的四个开关。2026-09-20 核对发现：开关可保存和恢复默认，但当前生成链没有读取这些配置键。因此它们是已展示、尚未接入执行链的配置，不能保证改变生成行为。'),
 ('| 选项 | 默认值 | 作用 |', '| 选项 | 默认值 | 界面描述的预期作用（当前未接线） |'),
 ('## 使用建议', '## 接线后的预期用法（设计说明）\n\n以下保留原设计意图，当前不作为操作或排障依据。实际连续性、重试和模型选择由各生产入口自身实现决定。'),
 ('保持 `视觉连续性` 开启。它会尽量让后续分镜参考上一分镜尾帧，适合角色连续出场、场景连续推进和长镜头感更强的短片。', '`视觉连续性` 的预期是传递上一镜尾帧；当前需在实际生产入口核对参考图、首尾帧和已绑定素材，切换此开关不会自动接入尾帧传递。'),
 ('保持 `断点续传` 和 `内容审核容错` 开启。这样网络中断、API 超时或单个分镜失败时，不会轻易导致整批任务从头开始。', '`断点续传` 与 `内容审核容错` 的预期是减少重跑；当前须按实际任务队列的重试和失败规则处理，这两个开关不提供跳过失败或恢复任务的保证。'),
 ('只有在已经配置了多个视频模型，并且明确知道哪些模型适合文生视频、哪些适合图生视频时，再开启 `多模型自动切换`。', '`多模型自动切换` 的预期是按镜头位置选择文生/图生视频；当前应在云端AI模型映射或具体生产入口选择模型。'),
 ('- `视觉连续性` 是否开启。', '- 实际生成入口是否装配了上一镜尾帧或所需参考图；不以此开关状态判定。'),
 ('- `断点续传` 是否开启。', '- 实际任务是否支持重试，以及失败项与已完成项的记录是否完整。'),
 ('### 开启多模型自动切换后生成失败', '### 多模型生成失败'),
 ('- 不确定时先关闭 `多模型自动切换`，用单模型流程确认基础生成链路。', '- 用已配置的单模型流程确认基础生成链路；当前此开关不参与生产选择。\n\n源码核对：`AdvancedSettingsTab.tsx` 展示开关，`api-config-store-types.ts` 定义默认值，`api-config-store.ts` 负责保存；生产接线完成后须同步本说明。'),
])
update('docs/settings/API_MANAGER_OPERATIONS.md',[
 ('当前可见供应商中已经填写有效配置的数量', '当前可见供应商中填写了非空 API Key 的数量，不校验 Base URL、模型或连接是否有效；免 Key 的本地 TTS 不计入该数'),
 ('请求会按顺序轮询到已选模型，默认间隔 3 秒，避免单一 API 限流。', '多模型配置在每次取用时按顺序轮询，没有固定 3 秒调用间隔。部分失败重试使用 3 秒基础退避；并发与供应商限流仍需单独控制。'),
])
update('docs/settings/API_PROVIDER_MODEL_TEST_REFERENCE.md',[
 ('| `The operation was aborted` / `AbortError` | 15 秒超时 |', '| `The operation was aborted` / `AbortError` | 联网测试超时：图片 120 秒，文本等默认 15 秒；video / TTS / vision 当前只做配置 dry-run |'),
])
update('docs/panels/APPEARANCE_THEMES.md',[
 ('每套模板只展示一个标准主色', '当前皮肤展示主调色与强调色两个色点'),
 ('| 模板 | 主色 | 适用场景 |', '| 模板 | 预览渐变中的参考色（不是主调色） | 适用场景 |'),
])
update('docs/panels/voicebox-voice-cloning-flow.md',[
 ('| `GET` | `/generate/{id}/status` | 查询语音生成状态 |', '| `GET` | `/generate/{id}/status` | 查询语音生成状态 |\n| `POST` | `/generate/{id}/cancel` | 请求取消指定语音生成任务 |'),
 ('`<storageBasePath>/model/TTS`', '`<storageBasePath>/comfyui/models/TTS`'),
 ('生成与模型管理路由（旧 `engine.py`/`catalog.py`/`model_cache.py` 已重构并入）', '生成与模型管理路由；调用 `apps/backend/engines/tts_engine/` 下仍在使用的 `engine.py`、`catalog.py`、`model_cache.py`'),
 ('`{userData}/tts-runtime/tts.sqlite` 中的错误字段', '`<storageBasePath>/TTS/runtime/tts.sqlite` 中的错误字段（`{userData}/tts-runtime` 仅为 legacy 路径）'),
])
update('docs/panels/TTS_PANEL_OPERATIONS.md',[
 ('| 状态 | 未安装、已安装未运行、运行中、运行中（残留进程） |', '| 状态 | 未配置、Python 就绪，依赖未配置、已安装，未运行、运行中、运行中（残留进程）等，按当前探针显示 |'),
])
update('docs/settings/TTS_CONFIG_GUIDE.md',[
 ('- `本地 TTS 后端启动失败`', '- `本地 TTS 后端启动失败`\n\n运行时卡片还区分 `未配置`、`Python 就绪，依赖未配置`、`已安装，未运行` 与运行中状态，不能把 Python 已就绪等同于 TTS 依赖已完成。'),
 ('- `下载失败`', '- `下载失败`\n- `启动后扫描`：后端尚未返回磁盘扫描结果，不代表模型缺失'),
])
for p in sorted((ROOT/'docs/panels').glob('ASSIST_WORKBENCH*.md')):
 s=p.read_text(); title=s.splitlines()[0]
 update(p.relative_to(ROOT),[(title+'\n',title+'\n\n> 全文保留的是 2026-09-10 以前的辅助工作台历史界面与参数，文中“当前”均指原记录时点。今天的三个工作区及入口见[本地模型页](./LOCAL_MODELS_GUIDE.md)，不按下文旧步骤操作。\n')])
 if '（`漫影/3_声音/`）' in s: update(p.relative_to(ROOT),[('（`漫影/3_声音/`）','（当前仓库 `3_声音/`）')])
