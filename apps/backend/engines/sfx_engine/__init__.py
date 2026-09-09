"""音效(MusicGen 短事件域)推理引擎——权重发现+确定性生成(09-09 引擎层统一)。

确定性契约:同 (prompt, seed, model, device) → 字节级同 WAV(renderer 缓存依赖)。
照 Piper 纯引擎包先例:零 HTTP/零 CLI;sfx_gen/ 服务包向下调用。
"""
