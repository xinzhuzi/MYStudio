"""每模型独立模块(用户裁定 08-31:每个模型自己一个脚本)。

providers/ 下每个文件只管自己模型栈的 spec/解析/装配/生成/下载,互不
干扰;model_cache/pipeline/download_model 只做注册表+通用分派,不再内嵌
任何模型细节。09-09 改名消歧:原 engines/ 让名给托管引擎域
(engines/comfyui/,见 knowledge/backend-architecture.md)——这些是
生图提供方(本地模型栈+引擎路由桥),不是引擎。
"""
from . import krea2, flux2, z_image, qwen, comfyui_bridge

ALL_ENGINES = (krea2, flux2, z_image, qwen, comfyui_bridge)
