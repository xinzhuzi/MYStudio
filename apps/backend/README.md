# MYStudio Backend

漫影工作室本地 Python 后端，当前主要承载本地 TTS、声音克隆、模型下载状态和语音识别能力。它是 Electron 桌面应用启动的 sidecar 服务，不是独立 Web 后台。

## 目录结构

```text
apps/backend/
  manying_voicebox_tts/
    main.py          # ThreadingHTTPServer 服务入口
    engine.py        # TTS/STT 引擎调度
    storage.py       # tts.sqlite 运行时存储
    catalog.py       # 内置模型目录
    model_cache.py   # HuggingFace/ModelScope 缓存探测与下载
  requirements.txt   # Python 依赖清单
  tests/             # 后端契约测试
```

## 启动方式

应用启动时不会自动创建 venv、安装依赖或拉起 TTS 后端。

当前流程是：

1. 用户进入 `设置 -> Python 配置`。
2. 点击 `开始配置`。
3. Electron 运行时把 Python 3.12 配置到存储根目录下的 `python` 目录。
4. 使用该 Python 执行 `python -m pip install -r apps/backend/requirements.txt`。
5. 用户在 `设置 -> TTS 配置` 启动本地 TTS，或在口播/试听流程中触发启动。

默认监听地址：

```text
http://127.0.0.1:17593
```

## 运行时目录

| 目录 | 说明 |
|---|---|
| `<storageBasePath>/python` | Python 3.12 runtime，设置页手动配置 |
| `<storageBasePath>/tts-models` | 默认 TTS 模型缓存目录 |
| `{userData}/tts-runtime` | TTS sidecar 运行数据、`tts.sqlite`、生成音频、依赖 hash marker 和 runtime config |

`storageBasePath` 由应用存储设置决定；用户迁移项目存储目录后，Python runtime 和默认模型缓存也会跟随该目录。

## 服务实现

后端入口是 `manying_voicebox_tts.main`，使用 Python 标准库 `ThreadingHTTPServer`。除 `/health` 外，控制类接口都需要 Electron main process 注入 `X-Manying-TTS-Token`，前端 renderer 不直接持有 token。

启动命令由 `apps/frontend/electron/tts-runtime.ts` 生成，核心形式如下：

```text
python -m manying_voicebox_tts.main --host 127.0.0.1 --port 17593 --data-dir {userData}/tts-runtime
```

关键环境变量：

| 环境变量 | 说明 |
|---|---|
| `PYTHONPATH` | 指向 `apps/backend` 或安装包内 `Resources/backend` |
| `MANYING_TTS_DATA_DIR` | TTS runtime 数据目录 |
| `MANYING_TTS_MODELS_DIR` | 应用内配置的模型缓存根目录 |
| `VOICEBOX_MODELS_DIR` | 兼容旧命名的模型目录变量 |
| `HF_HUB_CACHE` | HuggingFace hub 扫描缓存 |
| `MANYING_TTS_CONTROL_TOKEN` | sidecar 控制 token |

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 健康检查，不需要 token |
| `GET` | `/models/status` | 列出模型下载、缓存、加载状态 |
| `GET` | `/models/cache-dir` | 返回模型缓存路径和扫描路径 |
| `GET` | `/models/progress-json/{model}` | JSON 模型下载进度 |
| `GET` | `/models/progress/{model}` | SSE 模型下载进度 |
| `POST` | `/models/download` | 开始下载模型 |
| `POST` | `/models/download/cancel` | 标记取消模型下载 |
| `POST` | `/models/{model}/unload` | 从内存卸载模型 |
| `DELETE` | `/models/{model}` | 删除已缓存模型 |
| `GET` | `/tasks/active` | 活跃下载和生成任务 |
| `GET` | `/profiles` | 列出声线 profile |
| `POST` | `/profiles` | 创建或更新声线 profile |
| `POST` | `/generate` | 异步生成语音 |
| `GET` | `/generate/{id}/status` | 查询生成状态 |
| `GET` | `/audio/{id}` | 读取生成的 WAV 音频 |
| `POST` | `/transcribe` | 音频转文本 |
| `POST` | `/shutdown` | 停止 sidecar |

## 依赖管理

- 依赖声明在 `apps/backend/requirements.txt`。
- 依赖安装由 `设置 -> Python 配置 -> 开始配置` 触发，不随应用启动自动执行。
- Electron runtime 使用 `requirements.txt` 内容和 Python 路径计算 hash marker；未变化时跳过重复安装。
- 安装目标是 `<storageBasePath>/python/lib/python3.12/site-packages` 对应的 Python 运行环境，不写入应用安装目录。

## 测试

后端契约测试入口从 `apps/` 目录执行：

```bash
PYTHONPATH=backend python3 -m unittest discover -s backend/tests
```

在 Electron/TypeScript 侧，TTS runtime 行为由 `apps/frontend/electron/tts-runtime.test.ts` 覆盖。
