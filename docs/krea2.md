# Krea2 本地生图指南(漫影工作室)

> 当前入口与历史实现对照（2026-09-20）：先按下节打开现行工作流；后面的旧模型清单和 React Flow 节点连线保留用于追溯，不是当前操作步骤。
> 生成纪律:本地模型**绝不自动下载**——一切经 设置→本地配置 显式获取。
> NSFW 能力仅限成年角色。

## 当前入口与仓库模板（2026-09-20）

在 `设置 → 本地配置 → ComfyUI 引擎` 准备引擎与模型，然后进入 `本地模型` 页的 ComfyUI 画布或 `漫影生图`。画布侧栏的 `repo:` 模板来自仓库，只读打开；需要改图时另存用户副本，不直接修改仓库模板。模型、input/output 与用户工作流目录以引擎 manifest 和设置页为准，不按下方历史安装目录推断。

| 用途 | 当前仓库入口（相对 `apps/backend/engines/comfyui/workflows/`） | 使用边界 |
|---|---|---|
| 画布文生图 | `1_图片/K2图像/1_文生图/K2-文生图.json` | 在 ComfyUI 画布加载，参数以该图实际节点为准 |
| Krea2 文生图桥模板 | `1_图片/K2图像/1_文生图/krea2-t2i.json` | 桥接调用的模板，不等同于用户画布存档 |
| 参考图编辑桥模板 | `1_图片/K2图像/3_改图/krea2-edit-ref.json` | 参考输入和节点参数以当前模板为准 |
| 降噪与超分 | `1_图片/K2图像/6_修复超分/K2-SeedVR2降噪后4K.json` | 先查参数速查及输入分辨率限制 |

`漫影生图` 的标准档使用 `manying_t2i` 桥，默认 8 步、可输入 1–40 步；加速档使用 `manying_t2i_fast`，固定 Krea2 Turbo 与加速 LoRA，步数只有 4/6 两档。它与自由编辑 ComfyUI 画布是两个入口。当前源码见 `apps/frontend/components/panels/assist/local-models/LocalModelStudio.tsx`。

完整模板清单见 [漫影工作流清单](./comfyui-kb/漫影工作流清单.md)，日常操作见 [本地模型页](./panels/LOCAL_MODELS_GUIDE.md)，采样与模型依赖见 [参数速查](./comfyui-kb/参数速查.md)。提示词参考资料位于 `docs/comfyui-kb/参考_提示词工程/`，不属于引擎工作流库。

## 历史功能映射与旧节点记录

> 以下一至五节保留早期工作流文件名、模型部署和旧 React Flow 组装说明。旧画布已退役，模型/端口/权重及性能未在本轮重测；使用现行模板时以其实际输入和模型清单为准。`apps/backend/image_gen/scripts/uncloth_pipeline.py` 仍存在，但文件存在不代表旧界面按钮仍可达。

### 一、历史应用功能 ↔ ComfyUI 工作流映射

| 应用功能 | ComfyUI 工作流(本机 `ComfyUI/user/default/workflows/漫影/1_图片/K2图像/`,按功能分六夹) | 关键参数 |
|---|---|---|
| 文生图(专业流) | `1_文生图/Krea2-NSFW专业流.json` | 8 步 · cfg=1 · euler/simple · denoise=1 |
| 图生图 | `2_图生图/Krea2-NSFW专业流-图生图.json`(全家桶亦在此夹) | 8 步 · cfg=1 · **denoise=0.6** · SDEdit(LoadImage→VAEEncode→KSampler) |
| 无衣物改图 | `3_改图/Krea2_无衣物_稳定.json` / `Krea2_无衣物_遮罩.json` | 双分割并集 + 两遍采样(脱衣 0.65 + 校色 0.3);krea2edit 整合流同夹 |
| 改图系列(衣物重绘/局部) | `3_改图/` 内按稳定/遮罩两档 | 与无衣物同构(蒙版来源不同) |
| 超分 4K | `6_修复超分/K2-SeedVR2降噪后4K.json` / 应用超分链 | realesrgan-x4plus-anime-6b |
| 提示词工程参考 | `漫影/4_参考_提示词工程/`(K2 提示词模板同款一份在 `K2图像/` 夹根) | — |

### 二、历史模型清单

| 模型 | 文件 | 大小 | 用途 | 下载位置 |
|---|---|---|---|---|
| Krea2 Turbo 主模型 | `krea2_turbo_bf16.safetensors` | ~12GB | 去噪主干 | ComfyUI `models/unet/`(应用指向现成文件,零重下) |
| 文本编码器 | `qwen3-vl-4b-heretic.safetensors` | ~8.8GB | 破限 TE | ComfyUI `models/clip/`;官方 TE 优先、heretic 回退 |
| VAE | `qwen_image_vae.safetensors` | ~500MB | 编解码 | ComfyUI `models/vae/` |
| LoRA:Mystic XXX v3 | `KREA 2 Mystic XXX v3.safetensors` | — | 风格(当前 0.8,可调) | ComfyUI `models/loras/` |
| LoRA:pussy | `Krea 2 pussy.safetensors` | — | 细节(强度 0.3;脏斑时降到 0.15) | 同上 |
| LoRA:NSFW V4 | `Krea 2 NSFW V4.safetensors` | — | 可选(默认关) | 同上 |
| **分割:衣物部位** | `segformer_b3_clothes/` | 180MB | 无衣物节点分割① | ComfyUI `models/segformer_b3_clothes/`(LayerMask 生态);复制到 `<userData>/model/imagegen/segformer_b3_clothes/` |
| **分割:人体解析** | `fashn-human-parser/` | 256MB | 无衣物节点分割②(手臂/腿) | HuggingFace `fashn-ai/fashn-human-parser`(nvidia/mit-b4 底座);放 `<userData>/model/imagegen/fashn-human-parser/` |

> 模型缓存目录的实时路径看 设置→本地配置→模型缓存目录(复制/打开按钮)。

### 三、历史 React Flow 组装（非当前 ComfyUI 操作）

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

### 四、历史节点参数速查

核心区:脱衣遍 denoise(0.65)/seed(3)、校色遍 denoise(0.3)/seed(1)、
步数(8)、蒙版收缩(-16)/外扩(+16)、输入上限 MP(1.0)、
分割部位勾选(segformer)+fashn 部位、重绘提示词。
高级区:LoRA 四槽(NSFW V4 关/Mystic 0.8/空槽/pussy 0.15)、蒙版细节加工五参、
Rebalance 12 权重(单层 5.0)。

### 调参(工作流经验迁移)
| 现象 | 动作 |
|---|---|
| 重绘区与原图皮肤有色差 | 校色遍 denoise 0.3→0.4;GrowMask 外扩 16→32 |
| 残留衣物痕迹 | 脱衣遍 denoise 0.65→0.9~1.0 |
| 皮肤与周围分界生硬 | 蒙版外扩 16→32(过渡带加宽) |
| 脏斑/褐点 | 换 seed→pussy 0.15→0.08→Mystic 0.8→0.6→脱衣遍降(一次只改一项) |

### 五、历史 sidecar 实现说明(工程师向)

> 语境说明（2026-09-13）：本节描述的是**存量漫影生图 sidecar 直连线**（`image_gen` 域，端口 17595；辅助时代「无衣物直连」按钮仍在用此端点）。画布主线已迁 ComfyUI 工作流（见 §四与 [参数速查](./comfyui-kb/参数速查.md)）；改图流参数以参数速查的「稳定流终裁」口径为准（取代旧四档说法）。

- 图生图=经典 SDEdit(VAE 编码→按 strength 加噪→部分步去噪);
  masked 版(无衣物)=引擎 `generate_masked_sdedit`:复用 diffusers
  管线 `__call__`,`callback_on_step_end` 每步把蒙版外锚定回「原图在当前
  sigma 的加噪版」(ComfyUI `SetLatentNoiseMask` 等价);sigma 表按截断
  传入(管线缺省按 eff_steps 从 1 重算,与初始 latent 噪声级错位会出白块)。
- 独立复跑脚本:`apps/backend/image_gen/scripts/uncloth_pipeline.py`
  (分段日志:分割耗时/蒙版覆盖率/两遍参数)。
- sidecar 端点:`POST /v1/images/uncloth`(prompt+input_image+params)。
