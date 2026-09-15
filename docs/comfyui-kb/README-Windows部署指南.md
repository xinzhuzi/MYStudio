# Krea2 全家桶 · Windows 部署指南
> 本包内容:K2 全部模型(35G)+ 9 个工作流 + 3946 风格库 + 15 个插件(已离线打包)

## 一、放到 Windows ComfyUI 的哪里

| 本包文件 | 拷贝到 Windows ComfyUI |
|----------|------------------------|
| `models/diffusion_models/krea2_turbo_bf16.safetensors` | `ComfyUI/models/diffusion_models/` |
| `models/text_encoders/qwen3-vl-4b-heretic.safetensors` | `ComfyUI/models/text_encoders/` |
| `models/vae/qwen_image_vae.safetensors` | `ComfyUI/models/vae/` |
| `models/loras/` 整个文件夹(Krea2-NSFW + Krea2-功能) | `ComfyUI/models/loras/`(保持子目录名,工作流按此引用) |
| `workflows/*.json` | 任意位置,ComfyUI 界面里 Open 打开;或放 `user/default/workflows/` |
| `styles_for_EasyUse/styles` **整个替换** | `ComfyUI/custom_nodes/ComfyUI-Easy-Use/styles/` |
| `custom_nodes/` 下 15 个插件文件夹 | `ComfyUI/custom_nodes/`(可直接用;也可删掉改用 git 重装最新版) |

## 二、Python 依赖(Windows 命令行,ComfyUI 目录下)

桌面版(自带 python):用 ComfyUI 的 "Install Pip Packages"(Manager)装:
`numba piexif scikit-image scipy`
便携版:进入 python_embeded 目录用 `python.exe -m pip install numba piexif scikit-image scipy`

## 三、版本要求与首跑

1. **ComfyUI 核心要够新**(CLIPLoader 里必须有 `krea2` 类型)——用官方桌面版最新即可
2. 装好重启 → 打开 `MY-K2_文生图_超集.json` → 写提示词 → 生成(全链 LoRA 栈默认激活;日常稳妥用 `MY-K2-文生图.json`,LoRA 栈默认旁路)
3. 有红节点 → Manager → 安装缺失节点 一键补

## 四、工作流速查(9 个)

| 文件 | 用途 |
|------|------|
| MY-K2_文生图_超集 | 文生图超集档,LoRA 栈默认激活(09-15 替代简版;稳妥档=MY-K2-文生图) |
| Krea2-NSFW专业流 | 按层加权破限(Rebalance节点) |
| Krea2-无审查全家桶 | 生产级:提示词增强+4K放大+对比(开关式) |
| Krea2-风格扩展流(3946种) | 文生图+3946风格选择 |
| krea2-风格扩展流(图生图版) | 图生图+风格 |
| krea2-图像编辑-整合流 | 指令式编辑(identity LoRA) |
| K2-SeedVR2修复 / 降噪后4K / 去噪精修 | 超分/降噪精修流(需 SeedVR2 模型,H3线同款) |

## 五、注意事项(经验)

- **cfg 固定 1 勿动**(K2 蒸馏模型不吃负提示词);步数 8 起步,细节要求高改 12
- `identity_edit_v1_2` LoRA 只用于编辑流,**挂纯文生图会破坏提示词服从**
- NVIDIA 卡勿下 nvfp4/mxfp4 格式以外的坑:nvfp4 仅 RTX50 系;显存 ≤12G 建议 GGUF Q4/Q6(vantagewithai/Krea-2-Turbo-GGUF,本包未含)
- 提示词用完整英文描述句;NSFW 仅限成年角色,年龄滑块类 LoRA 红线勿碰
- 高清需求:直接生成分辨率可到 1152×1728;再高用全家桶的 4K 放大段或 SeedVR2 流

## 六、备选下载地址(需要重下时)

- 模型三件套:HF `Comfy-Org/Krea-2` + `DreamFast/Qwen3-VL-4b-Heretic-ComfyUI`(免gated)
- GGUF 量化:`vantagewithai/Krea-2-Turbo-GGUF`
- 无审查整模:`ChrisColeTech/krea2-turbo-uncensored-v1.1-FP8`
- NSFW LoRA:`RomixERR/Krea2_turbo_bf16_Workflow_LORA_NSFW` + `uzumix/krea2_nsfw`
- CivitAI(登录+开NSFW):全家桶 #2738703 / LUSTIFY #573152 / Kroma2x #2827913
