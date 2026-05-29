# MYStudio Backend

漫影工作室本地 Python 后端，提供 TTS 声音克隆等 AI 能力。

## 架构

```
src/backend/
  manying_voicebox_tts/     # TTS 服务模块
    main.py                 # HTTP 服务入口
    engine.py               # TTS 引擎（Qwen MLX / PyTorch）
    storage.py              # SQLite 运行时存储
    catalog.py              # 模型目录
    model_cache.py          # HuggingFace 模型缓存管理
  requirements.txt          # Python 依赖
  tests/                    # 测试
```

## 运行方式

应用启动时自动：
1. 在 `{userData}/tts-runtime/venv/` 创建虚拟环境
2. 安装 `requirements.txt` 中的依赖
3. 用 venv python 启动后端，监听 `http://127.0.0.1:17593`

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查 |
| GET/POST | /profiles | 声线 profile 管理 |
| POST | /generate | 开始生成语音 |
| GET | /generate/{id}/status | 查询生成状态 |
| GET | /audio/{id} | 获取生成的音频 |
| GET | /models/status | 模型下载状态 |
| POST | /models/download | 下载模型 |

## 依赖管理

- 依赖声明在 `requirements.txt`
- 启动时通过 MD5 hash 检测变更，变更后自动重新安装
- venv 隔离，不污染系统 Python
