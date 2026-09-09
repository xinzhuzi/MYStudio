"""Music3(MLX)引擎权重件——权重发现+mlx-serve 布局安装(09-09 引擎层统一)。

形态特殊(推理经 mlx-serve 服务,非进程内):本包只收权重侧(model_cache=
发现/下载评估,install_mlxserv_weights=bf16 权重装进 mlx-serve 布局);
生成交互(music3_gen/worker 与 mlx-serve 对话)留在服务包,后续过堂再裁。
"""
