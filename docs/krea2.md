# Krea2 本地生图指南(漫影工作室)

> 应用内全部 Krea2 能力与 ComfyUI 工作流、模型、组装方式的对照文档。
> 生成纪律:本地模型**绝不自动下载**——一切经 设置→本地配置 显式获取。
> NSFW 能力仅限成年角色。

## 一、应用功能 ↔ ComfyUI 工作流映射

| 应用功能 | ComfyUI 工作流(本机 `ComfyUI/user/default/workflows/K2图像/`) | 关键参数 |
|---|---|---|
| 文生图(专业流) | `Krea2-NSFW专业流.json` | 8 步 · cfg=1 · euler/simple · denoise=1 |
| 图生图 | `Krea2-NSFW专业流-图生图.json` | 8 步 · cfg=1 · **denoise=0.6** · SDEdit(LoadImage→VAEEncode→KSampler) |
| 无衣物改图 | `Krea2-NSFW专业流-改图-无衣物.json` | 双分割并集 + 两遍采样(脱衣 0.65 + 校色 0.3) |
| 改图系列(衣物重绘/局部) | `Krea2-NSFW专业流-改图*.json` | 与无衣物同构(蒙版来源不同) |
| 超分 4K | `K2-SeedVR2降噪后4K.json` / 应用超分链 | realesrgan-x4plus-anime-6b |
| 提示词工程参考 | `参考_提示词工程/` `K2-图生图提示词模板.md` | — |

## 二、模型清单

| 模型 | 文件 | 大小 | 用途 | 下载位置 |
|---|---|---|---|---|
| Krea2 Turbo 主模型 | `krea2_turbo_bf16.safetensors` | ~12GB | 去噪主干 | ComfyUI `models/unet/`(应用指向现成文件,零重下) |
| 文本编码器 | `qwen3-vl-4b-heretic.safetensors` | ~8.8GB | 破限 TE | ComfyUI `models/clip/`;官方 TE 优先、heretic 回退 |
| VAE | `qwen_image_vae.safetensors` | ~500MB | 编解码 | ComfyUI `models/vae/` |
| LoRA:Mystic XXX v3 | `KREA 2 Mystic XXX v3.safetensors` | — | 风格(强度 1.0) | ComfyUI `models/loras/` |
| LoRA:pussy | `Krea 2 pussy.safetensors` | — | 细节(强度 0.3;脏斑时降到 0.15) | 同上 |
| LoRA:NSFW V4 | `Krea 2 NSFW V4.safetensors` | — | 可选(默认关) | 同上 |
| **分割:衣物部位** | `segformer_b3_clothes/` | 180MB | 无衣物节点分割① | ComfyUI `models/segformer_b3_clothes/`(LayerMask 生态);复制到 `<userData>/model/imagegen/segformer_b3_clothes/` |
| **分割:人体解析** | `fashn-human-parser/` | 256MB | 无衣物节点分割②(手臂/腿) | HuggingFace `fashn-ai/fashn-human-parser`(nvidia/mit-b4 底座);放 `<userData>/model/imagegen/fashn-human-parser/` |

> 模型缓存目录的实时路径看 设置→本地配置→模型缓存目录(复制/打开按钮)。

## 三、组装(画布上怎么连)

### 文生图
提示词节点 →(文本边)→ 成图节点 → 点「生成」。

### 图生图
参考图节点 →(图边)→ 成图节点 ←(文本边)← 提示词节点;成图点「生成」
(输入参考图经等比缩放+居中裁剪,不拉伸变形)。

### 无衣物改图
```
参考图/成图 ──图边──┐
                    ├─→ 无衣物节点 ──→ 成图节点(点「生成」执行整链)
提示词节点 ──文本边─┘
```
- 无衣物节点只放参数;成图节点是唯一执行入口,结果直通成图;
- 节点内提示词优先,留空回落连线的提示词节点;
- 支持链式(上游无衣物→下游无衣物→成图)。

## 四、无衣物节点参数速查

核心区:脱衣遍 denoise(0.65)/seed(3)、校色遍 denoise(0.3)/seed(1)、
步数(8)、蒙版收缩(-16)/外扩(+16)、输入上限 MP(1.0)、
分割部位勾选(segformer)+fashn 部位、重绘提示词。
高级区:LoRA 三槽(NSFW V4 关/Mystic 1.0/pussy 0.3)、GuidedFilter、
Rebalance 12 权重(单层 5.0)。

### 调参(工作流经验迁移)
| 现象 | 动作 |
|---|---|
| 重绘区与原图皮肤有色差 | 校色遍 denoise 0.3→0.4;GrowMask 外扩 16→32 |
| 残留衣物痕迹 | 脱衣遍 denoise 0.65→0.9~1.0 |
| 皮肤与周围分界生硬 | 蒙版外扩 16→32(过渡带加宽) |
| 脏斑/褐点 | 换 seed→pussy 0.3→0.15→Mystic 1.0→0.8→脱衣遍降(一次只改一项) |

## 五、管线实现说明(工程师向)

- 图生图=经典 SDEdit(VAE 编码→按 strength 加噪→部分步去噪);
  masked 版(无衣物)=引擎 `generate_masked_sdedit`:复用 diffusers
  管线 `__call__`,`callback_on_step_end` 每步把蒙版外锚定回「原图在当前
  sigma 的加噪版」(ComfyUI `SetLatentNoiseMask` 等价);sigma 表按截断
  传入(管线缺省按 eff_steps 从 1 重算,与初始 latent 噪声级错位会出白块)。
- 独立复跑脚本:`apps/backend/image_gen/scripts/uncloth_pipeline.py`
  (分段日志:分割耗时/蒙版覆盖率/两遍参数)。
- sidecar 端点:`POST /v1/images/uncloth`(prompt+input_image+params)。
