# 04 · SelfLift 节点与主流工作流终态

> 来源主题段 10:27–12:08（终态工作流组装）+ 13:03–13:24（SelfLift 算法真相）。
> 核心画面证据：frame_0013（14:03，完整 ComfyUI 工作流截图，节点参数逐字放大核对）。

## SelfLift 节点是什么 [t=10:27-10:41]

把「**latent 放大 + 二次采样**」的流程包装成**一个节点**，从而得到目前最主流的工作流——
**SelfLift 二采工作流**（兼顾速度和性能的最优解）。

<!-- 来自 frame_0013 · 14:03 —— 节点全名 SelfLift Progressive Sampler (MiniMax H3)，上方分组标签 comfyui-SelfLift -->

## 节点参数全解（帧证据逐字）

`SelfLift Progressive Sampler (MiniMax H3)`（来自 `comfyui-SelfLift` 包）：

| 参数 | 值 | 含义 |
|---|---|---|
| `seed` / 生成后控制 | 248078428236429 / randomize | 种子 |
| `cfg` | **1.0** | CFG=1（蒸馏件标准用法，配 ConditioningZeroOut 出 negative） |
| `transition_step`（转换输入点） | 由外部接入（帧中=「2nd采样步数」4） | **一采→二采的切换步**：低清步数到此为止，之后进入放大+高清段 |
| `lowres_scale` | **0.50** | 一采低清比例（目标 1MP 时一采≈0.5MP） |
| `rho` | **0.00** | **SelfLift 算法开关权重：0=关闭自研加速算法，退化为普通二采**（见下节） |
| `w_min` / `w_max` | 0.50 / 1.00 | SelfLift 算法相关权重带（rho=0 时不起作用） |
| `model_hires`（输入） | 接 LoRA 后模型 | 高清段用的高分辨率模型口 |
| 模型文件 | `minimax_h3_latent_upscaler_3d_bf16.safetensors`（截断） | **内置训练型 3D latent 放大器**，桥接两采 |
| `highres_tiling` 高分辨率分块 | 关闭 | 高清段平铺开关 |
| `upscaler_unload` 放大后卸载 | 开启 | 放大器用完即卸，省显存 |

配套的 `H3 Sigma Refiner`（来自 `YCNodes-MiniMax-H3` 包，串在 SIGMAS 链上）：

| 参数 | 值 |
|---|---|
| `extra_steps` | **1** |
| `start_at_sigma` | 0.70 |
| `end_at_sigma` | 0.00 |
| `spacing` | cosine |

<!-- 来自 frame_0013 · 14:03 —— 以上两表全部参数逐字放大核对（2.5–12 倍裁剪） -->

> 仓库定位（2026-11-07 补查）：YCNodes 包 = `github.com/yichengup/ComfyUI-YCNodes-MiniMax-H3`
> （MIT，265 stars，最后 push 2026-09-15；共 6 节点：二采条件注入 / 时间段提示词 / 动态 CFG /
> 低噪声细化 / **H3 Sigma Refiner**（scheduler 类第 5 号）/ 分块采样；无第三方依赖仅 PyTorch）。
> 仓库文档与帧参数互验吻合：`extra_steps` INT 默认 1 范围 0–15、`start_at_sigma` 默认 0.7、
> `spacing` 可选 cosine/linear/exponential。

## SelfLift 算法真相（作者自曝）[t=13:03-13:24]

- SelfLift 节点**不只是简单的二次采样**：它的**本意是通过一个叫 SelfLift 的算法进行加速采样**；
- 但在实际 ComfyUI 中启动这个算法时**速度比较慢，而且效果也不好**；
- 所以**大多数人都把这个功能关闭了——把里面的 rho 设置成 0——就变成了普通的二采**。

> 与本仓的接口：1107 记忆档「SelfLift 装毕但会吞一采被用户叫停」——本节正是那次事故的原理钥匙：
> rho>0 时 SelfLift 算法接管采样（可能吞掉/改写一采轨迹），rho=0 才是稳定的「纯二采」形态。
> 2026-11-07 双机源码探查：Mac 引擎与 Win 引擎 custom_nodes 现均**无** SelfLift / YCNodes 包
> （Win 侧疑已随 1107 叫停卸除），如需复装按本表参数对齐。
>
> **仓库定位（2026-11-07 补查，采用时用）**：SelfLift 包 = `github.com/facok/comfyui-SelfLift`
> （最后 push 2026-09-18；README 定位 "Progressive-resolution sampling"，低清跑早期步再 lift 到全分辨率收尾）；
> 内置 latent 放大器下载源 = HF `LBH-123-AI/Minimax_h3_latent_Upscaler`，节点按文件名含 "h3" 自动匹配。

## H3 Sigma Refiner 的真作用（作者自曝）[t=12:53-13:02]

**不是调整 σ 曲线**，只是**在采样的最后增加了一步**，让 σ 值的过渡更加平滑一点。
（对应帧证据 `extra_steps=1`；口播「前 6 步模糊、最后 2 步清晰」的 σ 曲线改造叙事，实际落点就是这个补步节点。）

## 终态工作流完整拓扑快照（frame_0013 逐节点）

```
[UNet加载器] minimax_h3_ref2va_pruned_int8_convrot.safetensors (weight_dtype=default)
   ↓ MODEL
[LoRA加载器(仅模型)] minimax_h3_fi2v_lightx2v_turbo_4step_v0.1_comfy.safetensors @ strength 1.00
   ↓ MODEL ──────────────────────────────┐(另支→基本调度器.model)
[加载CLIP] qwen3vl_32b_minimax_h3_int8_convrot.safetensors (type=minimax)
   ↓ CLIP                                │
[加载VAE]×2: minimax_h3_video_vae_fp16 + minimax_h3_audio_vae_fp32(截断)
   ↓ VAE/audio_vae                       │
[MiniMax H3 参考转视频] ref_image_size=max; ref_images×3/ref_videos/ref_video_audios/ref_audios
   ├─ positive ──→ [条件零化 ConditioningZeroOut] ──→ SelfLift.negative
   └─ LATENT ────────────────────────────┼→ SelfLift.latent_image
                                         │
[1st采样步数=7(fixed)] → [基本调度器 sgm_uniform, denoise=1.00] → [H3 Sigma Refiner
                        extra_steps=1 / start 0.70 / end 0.00 / cosine] → SelfLift.sigmas
[2nd采样步数=4(fixed)] → SelfLift.transition_step
[K采样器选择] → SelfLift.sampler
[SelfLift Progressive Sampler (MiniMax H3)] cfg=1.0, lowres_scale=0.50, rho=0.00,
                        w_min=0.50, w_max=1.00, 放大器=minimax_h3_latent_upscaler_3d_bf16,
                        高分辨率分块=关, 放大后卸载=开
   ↓ LATENT
[VAE解码](video) + [VAE解码(音频)] → [创建视频 fps=24 / 8bit / sRGB] → [保存视频 video/MiniMax_H3]
```

输入侧：视频时长 5.0s；画幅 16:9、**megapixels=1.2**、multiple=32；参考图1（透明电竞鼠标 2496×1304）；
提示词为英文分镜式（`[0.0s–1.5s]`…`[1.5s–3.5s]`… 分段节拍风）。

<!-- 来自 frame_0013 · 14:03 —— 拓扑与全部数值逐字核对；连线中标「推断」的两处：提示词→参考转视频输入、2nd采样步数→transition_step -->

## 口播与帧证据的两处口径差（如实记录）

1. **步数**：口播「前半一共 8 步、后面 4 步」[t=10:14-10:20]；帧=一采 7 步 + Sigma Refiner extra_steps=1，
   7+1=8 与口播吻合（推断），二采 4 步两边一致。
2. **LoRA 文件名**：帧逐字（1200% 放大）为 `minimax_h3_fi2v_lightx2v_turbo_4step_v0.1_comfy.safetensors`。
   **终裁（2026-11-08，发布包 JSON 解析）**：真 LoRA = `dmad_minimax_h3_8step_full_critic_comfyui` @1.0
   （8 步 DMD）——帧里那个 fi2v 名是录屏旧变体；此前「镜像改名」中间假设一并作废。
   详见 `workflows/README.md` 第 5 节与 `06-与现有技能交叉核对.md` 1108 节。

## 提示词样例（产品广告，节拍分段风格）

> Editorial cinematic technology product commercial. Use \<Picture 1\> as the exact opening frame.
> Preserve the exact appearance and structure of the transparent gaming mouse from the input image: …
> [0.0s–1.5s] Begin exactly from \<Picture 1\>. … The camera performs a smooth, deliberate push-in …
> [1.5s–3.5s] A fast, seamless cinematic transition into an extreme macro close-up …
> [3.5s–5.0s] …（下方被画面裁切）

<!-- 来自 frame_0013 · 14:03 —— 节点右缘在截图内自身截断，转写按可见部分逐字 -->

与本技能 `../SKILL.md` 的口径印证：`[0.0s–1.5s]` 节拍式是**可读速记**，官方稳妥格式仍是
`[Shot N]` + `At 00:04.500`；「Use <Picture 1> as the exact opening frame」即 I2V 固定首句的参考式变体。
