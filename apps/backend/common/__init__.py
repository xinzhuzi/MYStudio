"""共享基建域(三域分层之域3,零业务语义)。

model_cache_core=模型缓存骨架(HF blob/snapshot 家族+pinned 单文件家族,
按 env_names 参数化);modelscope_hub=ModelScope 直链下载。env 变量名=
Electron spawn 契约,永远按家族分表,禁止归一(09-08-31 spec 裁定)。
"""
