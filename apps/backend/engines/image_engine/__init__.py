"""生图推理引擎(每模型独立模块,用户裁定 08-31:每个模型自己一个脚本)。

krea2/flux2/z_image/qwen=本地模型栈;comfyui_bridge=生图经 ComfyUI 引擎
执行的路由 provider。model_cache=权重发现(env 契约不变)、workflows=K2
四模板(引擎资产)。照 Piper 纯引擎包先例:零 HTTP;image_gen/ 服务包
(server/pipeline/model_inventory/download_model=spawn 面)向下调用。
09-09 演进:原 image_gen/engines/ → providers/(ba94435 消歧)→ 本位
engines/image_engine/(二次裁定:底层模型引擎统一入域)。
"""
from . import krea2, flux2, z_image, qwen, comfyui_bridge

ALL_ENGINES = (krea2, flux2, z_image, qwen, comfyui_bridge)
