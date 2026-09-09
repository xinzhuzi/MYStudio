"""BGM(MusicGen)推理引擎——权重发现+加载+生成 WAV(09-09 引擎层统一)。

照 Piper 纯引擎包先例:零 HTTP/零 CLI;audio_gen/ 服务包(worker=spawn 面/
download_model/model_inventory)向下调用。模型必须已在 HF 缓存,本包绝不自动下载。
"""
