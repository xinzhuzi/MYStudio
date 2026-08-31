"""每引擎独立模块(用户裁定 08-31:每个模型自己一个脚本)。

engines/ 下每个文件只管自己引擎的 spec/解析/装配/生成/下载,互不
干扰;model_cache/pipeline/download_model 只做注册表+通用分派,
不再内嵌任何引擎细节。
"""
from . import krea2, flux2, z_image, qwen

ALL_ENGINES = (krea2, flux2, z_image, qwen)
