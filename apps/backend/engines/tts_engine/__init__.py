"""TTS 模型引擎(tts_engine,09-09 用户裁定:底层模型引擎统一入引擎域)。

职责=模型目录(catalog)+权重发现/下载(model_cache)+加载与推理
(engine 族:Kokoro/Qwen3-TTS/whisper);照 Piper 先例(src/python_run/
piper/=纯引擎包,HTTP 服务在包外)——本包零 HTTP、零 sqlite、零路由,
tts/ 服务包向下调用本包,反向依赖禁止。env 变量名=Electron spawn 契约
(MANYING_TTS_MODELS_DIR 等),搬代码不改契约。
"""
