"""MYStudio 本地成片观感评分(video QC)sidecar。

镜像 depth_estimation/upscale 的 worker 惯例;模型绝不自动下载,
设置页显式触发(download_model.py),渲染时缺模型=QC 链跳过+标注。
"""

__version__ = "0.1.0"
