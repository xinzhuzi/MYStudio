# 小黑 H3→LTX2.5 链可吸收排查（2026-11-06）

> 对象：B 站 UP「8g显存小黑的折腾日记」（space.bilibili.com/96854764）搬运的 H3→LTX2.5 二采材料包，落在 `~/Downloads/1106-xiaohei-h3ltx/`：**6 个**工作流 json(节点数 67/76/76/75/77/45) + 《H3LTX2.5二采_节点包与安装说明.txt》(172 行) + `h3转ltx25精修提示词` skill(zip+解包)。
> 排查范围=包内全部明文资产：6 个 workflow 的节点图与 Note 便签正文(含逐件模型下载清单)、安装说明、skill 正文；交叉核对=我方两引擎实注册表 + 双机模型 inventory + 我方生产工作流 `pika-单镜视频-三段链.json`(88 节点)。
> **来源定性**：小黑自述「资源来自开源社区各位作者的公开分享，小黑只做搬运汇总、版权归原作者」，模型分发走**夸克网盘直链**(Note 节点内嵌)→ 属第三方搬运，**只仿设计与参数口径，禁拷其自研包代码/文案**。
> **但"网盘=唯一来源"这一点已被 1106 复查推翻**：他 widget 里的目录前缀 `H3\Kijai\` 就是 HF 作者 **Kijai** 的 repo——三枚"网盘-only"件全部在 HF 正版在架(refiner rank16 / lynnreal light VAE / taeh3)，故我方一律**改指 HF 直链并核 sha256，不碰网盘**(定谳见 §二 B 层与 §四 C14-C16)。
> 作者原环境：RTX 4060 Laptop **8GB** + `--lowvram` + ComfyUI 0.37.0。我方 Win 引擎实测=ComfyUI **0.44.0** @17000、RTX PRO 4000 Blackwell **23.9 GiB**；Mac 引擎(17001)本轮未启动，改走磁盘静态核账。
> 最后核账：2026-11-06（Win `/object_info` 7,202,207 B 实拉；双机模型目录实列；B 件 sha256 实比对；候选实件 **safetensors 头文件 Range 实探**(B1 官方 refiner 键名域 / B3 快速 VAE 有无 encoder)；**HF repo tree API 逐个复核 16 个候选仓库**(Kijai/Efficient-Large-Model/Comfy-Org/stdstu123/madebyollin/t8star/OzgyGT 等)；MiniMax H3 Community License 原文 84 行实读——本节结论以此为准）。
> 本档与 Trellis 役 `.trellis/tasks/11-06-xiaohei-h3ltx-absorb/prd.md` 同一口径：§三=执行分工，§四 C1-C15=冲突消解硬门禁（其中 C9/C10/C11/C12/C14/C15 推翻 grill 前我自己的推荐原文）。

## 一、资产全景定性

| 层 | 是什么 | 可读性/可跑性 |
|---|---|---|
| 6 个 workflow json | 3 代 LTX 换域二采(一代极速/二代音频对齐/三代单人锁脸) + 2 件三步精修(「二采放大转 LTX 首尾」「放大两倍首尾」) + `英伟达2klora精修.json`(45 节点) | ✅ 全读(节点图+Note 正文逐件核) |
| `Comfyui-XH_Toolbox` | 自研包(H3LTXAdapterLoader/Convert、XHImageResizeV2、XHLTXIdentityOverlap、XHLabel、XHTimer) | ❌ **包内未附带、无公开仓库**；Mac `custom_nodes` 零命中、Win `object_info` 零注册 → 换域链物理起不来 |
| `ComfyUI-KJNodes` / `ComfyUI-SolAttn_triton` / `Comfyui_Minimax_h3_latent_Upscaler` | 第三方公开包 | ✅ 我方两机**均已装**(Mac 侧 SolAttn 用 `ComfyUI-SolAttn-MPS` 对应 MPS；Win 侧 `SolAttnPatch` 已注册) |
| LTX2.5 家族权重 5 件 | 22b distilled transformer int8_convrot、gemma4-12b-with-proj TE、video/audio VAE、`h3_ltx_adapter/model.safetensors` | ❌ Win inventory 零命中(`diffusion_models`/`text_encoders`/`vae` 实列均无)；唯一痕迹是 1105 归档留下的**两个孤儿 `.ok` 标记** |
| 精修提示词 skill(297 行) | LTX 段提示词留空 vs 写全逐句台词的对照实验结论，附官方源码指向 | ✅ 全读，知识层可用 |

**换域线定谳：结构性不可跑（不是"效果存疑"）。** 三查皆断：①节点包缺(自研无源)；②适配器权重缺(`models/h3_ltx_adapter` 目录本包都没给件)；③LTX 五件权重缺。任一件补齐都只是"能启动"，全线仍要换 22B 模型族 + 新 TE + 双 VAE，与 1106 已定的 **RelayVSR 超分主力 + 源音直通** 裁定反向。故本役只吸收它能拆出来的东西。

### 前轮结论的纠错（四条：图证据三条 + provenance 一条）

| 前轮说法 | 实测 | 证据 |
|---|---|---|
| 「RTX VSR 覆盖全链」 | 6 件里**仅 2 件**含 `RTXVideoSuperResolution`（两件「二采放大转 LTX 首尾」「放大两倍首尾」）；且该节点 **Win 已注册、macOS 物理不可用** | 6 文件逐件 grep 节点类型(实测计数 0/0/0/4/4/0)；Win `/object_info` 命中，Mac `custom_nodes` 无对应包 |
| 「换 LTX 后音频必须重生成」 | 是**链选择**不是必然：一代极速版 `LTXVAudioVAEEncode` 缺席，走 `LTXVSeparateAVLatent`→`VAEDecodeAudio`→`CreateVideo` 直通源音；二代/三代才接 `LTXVAudioVAEEncode`→`LTXVConcatAVLatent` 重编码 | 三代音频支线连线对照一代同名支线 |
| 「`英伟达2klora精修.json` 用了 LTX 模型」 | 45 节点**零 LTX 权重**：UNETLoader=`H3\minimax_h3_fl2va_pruned_int8_convrot`、CLIPLoader=`H3\qwen3vl_32b_minimax_h3_nvfp4_awq`(minimax/default)、两枚 VAELoader=`H3\minimax_h3_audio_vae_fp32` + `H3\Kijai\minimax_h3_lynnreal_light_vae_int8_convrot`，LoRA 两枚=refiner rank16@1.0 + `pika_h3_flex_fl2va_v1_avg_rank_56_bf16`@1.0；"2K" 来自 Open-H3-Regenerate-2K 精修 LoRA。**但**链上确有 `LTXVSeparateAVLatent`/`LTXVConcatAVLatent` 两枚——它们是**AV latent 拆装工具**，不吃任何 LTX 权重(与我方 1105 二阶段放大段同款用法)，故"看到 LTXV 字样≠换了模型族" | 该件 6 处 loader/LoRA widget 实值 + 节点类型 census |
| 「refiner rank16 / lynnreal light VAE / taeh3 只在夸克网盘、provenance 不可核」 | **推翻：三枚全在 HF 正版在架**，文件名与体积逐一对上——`Kijai/MiniMax-H3-experimental` → `loras/minimax_h3_open_regenerate_2k_refiner_rank_16_bf16.safetensors` 155,133,472 B(sha256 `add559cd92e2b17b…`，另有 rank384 5.87 GB 同仓)、仓根 `minimax_h3_lynnreal_light_vae_int8_convrot.safetensors` 2,137,493,384 B(sha256 `f11f8b9b96c9dd22…`，上游 `stdstu123/LynnReal-Onmi-light-vae`)、`Kijai/MiniMax-H3-TAE` → `vae_approx/taeh3.safetensors` 9,791,388 B(sha256 `f0f60fa072089997…`；时序版=madebyollin `taehv` 件 22,709,752 B，只在 GitHub 不在 HF)。他 widget 里的 `H3\Kijai\` 前缀本就是线索。**前轮"零命中"是检索方法错**(HF 全站按文件名文本检索不可靠)→ 正解=按作者列 repo，再 `tree/main?recursive=true` 拿文件清单比名 | 16 个候选仓库 tree API 实查 + 三件头文件 Range 实探(LoRA `__metadata__` 自证 `source: Efficient-Large-Model/Open-H3-Regenerate-2K`、`converted_layout: comfyui_minimax_h3`) |

> 附带纠错一条：**"Win 引擎离线"是假结论**。本机 Clash 环境变量会让 `curl` 直接 exit 7(连接失败)，而 `nc -z 17000` 通、`curl --noproxy '*'` 200。凡走局域网引擎口，**必带 `--noproxy '*'`**，否则拿假离线当结论(违「查问题先读日志/一次空返回不当结论」)。

## 二、可吸收矩阵

### A 层：零下载，改参数/加一个节点即得

| # | 吸收件 | 小黑侧口径 | 对我们的落位 | 判据 |
|---|---|---|---|---|
| A1 | **`MiniMaxH3TokenCounter` 出片前预检门** | 挂在 conditioning 支路上，专门数 packed 序列长度(`[text \| keyframes/references \| audio \| video]` 布局)不启动采样 | **本役形态=只出实测表，真源零改动**(见 §四 C4/C9)：`apps/build/scripts/` 探针脚本把三段链转 API prompt 后在 payload 里临时接该件、run-to-node 只跑到它，测六格(0.4/0.9/1.0MP × 33/96/192f)成表追加进 `参数速查.md`。App 侧机检门**另立项**，不在本役 | 两机均已注册该节点，我方 `2_视频` 域**使用数=0**(实测)；正中 1105 记录的 2MP×192f 贴顶 97.6% 那类"跑下去才知道爆显存"场景 |
| A2 | **`MiniMaxChunkFeedForward [2, 4096]`** | UNET 后立刻挂，SwiGLU 按 packed token 维分块 | ②段 MODEL 链 `[202]→[203]` 之间插一枚，**默认不生效**(出厂旁路位)，开启条件写死=**≥2MP×192f 档**；Win 大分辨率档的削峰开关。**前置探针**:旁路位数值语义(直通 vs 整件剔除)必须先实测，不许猜数值上线(§四 C10) | KJ 源码自带说明=**输出与不分块等价**(纯削峰不改变结果)；我方 `2_视频` 域使用数=0(实测)，属白捡 |
| A3 | **sol-attn 参数臂** | `BlockSparseAttention["sol-attn", τ=1.3, start=0.2, end=1.0, dense_blocks="", min_tokens=12288, extra_tokens=256, "exact_kv_and_rows", verbose=true]` | **③组 `[313]` 现值零改动**(契约钉件=1104 1080p 终裁，§四 C3)；臂值只作 `参数速查.md` 候补臂行注记，实跑归对拍役 `11-06-xiaohei-absorb-duipai` | 我方 1105 已定 kitchen+sol-attn **勿拆对**；此臂只换 τ 与 dense_blocks，是纯参数实验，零装机 |
| A4 | **Open-H3 精修官方采样口径** | 小黑用 `BasicScheduler ["simple", 2, 0.2]` 近似 | **无 refiner 时 `[209]` 一字不动**(契约钉「UP 定谳」，§四 C1)：官方 `ManualSigmas "0.909375, 0.857143, 0.666667, 0"` + euler + CFG 1 + 初始态 `(1-σ0)·upscaled + σ0·noise`、model_time `1-σ` **只在 B1 refiner 真挂上那一发与 LoRA 同批生效**，并同批改契约 | NVIDIA(NVlabs/Sana sol-engine)README 原文给的"reference recipe"，比二手近似权威；σ 表与 refiner 是一副配方的两半，拆开改=无据变更 |
| A5 | **LTX 双投影源码指向 + 我方裁定的反证** | skill 引 `comfy/text_encoders/lt.py`(`LTXAVTEModel`/`DualLinearProjection`)、`comfy/ldm/lightricks/av_model.py:583 preprocess_text_embeds`；结论=精修段提示词留空时画面正常但声音"照唇动自由编音素"，写全逐句台词才可懂 | 记进 `分镜H3视频产线.md` 音路口径节 | 他方踩坑证据恰好**反证 1105「源音直通」裁定的必要性**：只要不重编码音频就不会出现编音素；顺带留一条"若将来做重编码，台词必须逐字给全"的前置条件 |
| A6 | **低显存三件套的组合纪律** | 安装说明 §6：目录名不改、装包/换模型必重启(热插拔不刷新下拉)、**同一模型上不得叠多个注意力补丁**(互相覆盖=白装)、备用实验分支不接线 | 画布/引擎运维注意事项，进本档留存 | 与我们的 kitchen/sol-attn 勿拆对口径同向，可直接引用为外部旁证 |
| A7 | **Triton kernel 首跑编译** | 「第一次明显慢，第二次才快，属正常」 | 对拍计时口径：首跑不计入样本 | Mac 侧走 `ComfyUI-SolAttn-MPS`，不适用；Win 侧对拍必须剔首跑 |

### B 层：实件（真金白银要落地的 4 件）

| # | 件 | 体积与来源 | 落位 | 状态 |
|---|---|---|---|---|
| B1 | **2K 精修 refiner LoRA** | **1106 provenance 定谳=HF 正版在架，零转换工作**：起手件 `Kijai/MiniMax-H3-experimental` → `loras/minimax_h3_open_regenerate_2k_refiner_rank_16_bf16.safetensors` **155,133,472 B(0.155 GB)**、sha256 `add559cd92e2b17b42ac080516b476df120903e485fc98add4538e0217820fbd`（他 widget 里的 `H3\Kijai\` 前缀本就是这条线索）；升档件=同仓 rank384 5.87 GB(sha `4bf30291…`)。键名实测=**ComfyUI 融合式** `diffusion_model.blocks.{0..49}.attn.qkv_proj.lora_A[16,5376]/.lora_B[21504,16]` + `attn.out_proj` + `mlp.fc1/.fc2` + `diffusion_model.token_refiner.blocks.{0,1}.*`(624 tensor 全 BF16、24 键模板)，`to_q/to_k/to_v`、`lora_unet_*`、`transformer.transformer_blocks.*` 计数全=**0**；`__metadata__` 自证 `converted_layout: comfyui_minimax_h3`、`conversion: "qkv block-diag fused (contiguous q\|k\|v); mlp.fc1 swiglu halves swapped; alpha folded into lora_B; scale 1.0 baked"`、`source: Efficient-Large-Model/Open-H3-Regenerate-2K`。**官方原件反而不要下**：`Efficient-Large-Model/Open-H3-Regenerate-2K-LoRA/open_h3_regenerate_2k_refiner_lora.safetensors` 8.30 GB FP32 用 **Diffusers 键名**(312 modules 全 `transformer.*.attn.to_q/to_k/to_v/to_out.0`+`ff.net.*`)→ 只作口径一手源与上游 provenance；社区 `Rkss` rank64 999 MB/r128 2.68 GB/r256 4.37 GB/r576 8.80 GB、`father558`+`1038lab` r128 comfy 1.96 GB 系重打包，键名未逐个抽头(已无需：Kijai 件就是合规正解且最小) | ②段 MODEL 链 `[203] SigmaShift → [215] kitchen → [210] BasicGuider`，插一枚 `LoraLoaderModelOnly` 于 `[215]→[210]` 之间(与小黑"精修 LoRA 最后挂"同序) | **1106 定谳：可直挂，缺口 0.155 GB 即可补**——Kijai 件的 `qkv_proj` 融合命名与我方 Cobijada pruned 基座(732 tensor，`model.diffusion_model.blocks.N.attn.qkv_proj`[21504,5376] + `mlp.fc1` + `token_refiner.blocks.N`)同域，块数 50+2 也对上；官方件那一枚**仍禁直挂**(Diffusers 分体键名 → `comfy/lora.py:419-423` H3 键图不做融合拆分，融合拆分只对 Flux3 `:352-357`/MOSSImage `:363-369` 实现 → 逐键丢弃、patch_dict 空、**不报错也不生效**)。**残留小坑**：Kijai 件每模块另带一枚标量 `.alpha` tensor(alpha 已折进 `lora_B`，可忽略)，严格加载器会打未知键告警 → 挂载有效性判据=**引擎日志 `lora key not loaded` 计数≈0**(铁律10)，不是"跑通了"。配方另两件(turbo v1.2、LMS r64)我方**已在位**这一条仍成立；Win 29 枚 LoRA 实列无任何 regenerate/refiner 件=缺口真实 |
| B2 | **`conv_v1` latent upscaler** | **零下载**：Win 现有 `latent_upscale_models/minimax_h3_latent_upscaler_3d_bf16.safetensors` 690,592,992 B，`Get-FileHash` 实算 SHA256=`4F57821F5837F32F7142B67D815606DBD7550F194E5C769F7D6C3F83B146A5E6`，与 LBH 原作者仓库 `minimax_h3_latent_upscaler_3d_conv_v1/minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors` 的 LFS `sha256=4f57821f5837f32f…` **逐字节相同** | 无需改动：`[206] MinimaxH3LatentUpscaler3D` 现值(`"target dimensions", 1280, 704, 32, true, true, cuda, fp16`)已在用同一份权重 | **前轮"要下 0.69G"的结论作废**——小黑只是换了文件名。同一份件同时挂在 `Efficient-Large-Model/Open-H3-Regenerate-2K/latent_upsampler/`、`1038lab`、`OxBee` 三处(同字节数)，来源干净 |
| B3 | **快速 VAE 解码件** | **两臂并存(1106 provenance+头文件双定谳)**。**臂 A=小黑那枚其实 HF 在架**：`Kijai/MiniMax-H3-experimental` 仓根 `minimax_h3_lynnreal_light_vae_int8_convrot.safetensors` **2,137,493,384 B(2.14 GB)**、sha256 `f11f8b9b96c9dd22b36bc6c18464b6929c207d247e6d865d90fe31588e58e7e2`(上游 `stdstu123/LynnReal-Onmi-light-vae` 的 int8-convrot 重量化；作者口径 ~1.3× 解码提速，需 ComfyUI ≥0.36，我方 0.44 ✓)。头文件 650 tensor(F32/F16/I8/U8)，**含 `encoder.*` 116 键(含 `encoder.conv_in/conv_out/down.0.block.*`) + `quant_conv`/`post_quant_conv` + metadata `latents_mean/std`** → **可整体替换现役件(encode+decode 一把抓)**，内部用 VAE 自己的命名(`decoder.transformer_blocks.N.attn.to_qkv`/`.ff.w1/w2` + `.weight_scale`)。**臂 B=官方 `Efficient-Large-Model/Open-H3-Regenerate-2K/vae_fast/fast_h3_vae_noncausal_24l.safetensors` 6.47 GB**(1.62 B 参数，非因果 24 层，README 实测 2560×1440 解码 **15 s → 1.6 s≈9.4×**)；**臂 C=低成本 `Comfy-Org/MiniMax-H3/vae/minimax_h3_sol_vae_int8_convrot.safetensors` 1.99 GB** | Win 落位目录=`models/vae/`(实测映射自 `extra_model_paths.yaml`；注意 `latent_upscale_models`/`vae_approx` **不在映射表内**，落 `ComfyUI/models/<同名夹>/`)；臂 A=现役 `VAELoader` 换名直替(链形态零改动)；臂 B=**须双 `VAELoader` 并存**(编码支路留现役件，只末段 `VAEDecode` 换件) | **臂 B 结构限制(头文件定谳)**：297 tensor 全 F32、1,617,806,936 参数、文件 6,471,256,328 B 自洽，前缀只有 `blocks`(288)/`norm_out`/`post_quant_conv`/`proj_out`/`register_tokens`/`x_embedder`，`encoder`/`down_blocks`/`conv_in` 计数=**0** → **无编码器、无 quant_conv**：`comfy/sd.py:1049` 原生识别(`blocks.0.scale1`+`x_embedder.weight`)、`:1059` 判非因果、`:1061` 层数=24、`:1072` `encoder=False`，`ldm/minimax/vae.py:441/453` `NonCausalViT3DDecoder(24)`、`:882` `decode_noncausal` → **VAELoader+VAE Decode 零改码可跑**；但 `vae.py:963` `encode()` 会打缺失的 encoder → **VAEEncode 直接 AttributeError**，故②段源视频编码必须留现役 `minimax_h3_video_vae_int8_convrot`(850 tensor，含 encoder 116 + `causal_encoder: true`/36 层)。**取舍账**=臂 B 提速高(9.4×)但改链且 6.47 GB；臂 A 提速温和(1.3×)但同尺寸可整替(2.14 GB)；两臂与现役件三发同题对拍，判据=②段末 `VAEDecode` 墙钟 + 抽帧目测/SSIM(臂 A 还须验 `VAEEncode` 换件后的画面一致性)。Win `vae` 实列 8 项无任何 light/fast/sol 件 → 缺口真实；**B2 已零下载定谳，不在此列** |
| B4 | **`taeh3` 预览件（顺带修一处存量缺陷）** | 小黑件名 `taeh3_decoder.safetensors` 经 1106 复查=**他自己的本地改名**，HF 无此名。正版在架两枚：**①`Kijai/MiniMax-H3-TAE` → `vae_approx/taeh3.safetensors` 9,791,388 B**、sha256 `f0f60fa072089997f817402098c2fd90777cb2660dd79cf5df42fc1e3e08e527`(81 tensor fp32，朴素 `N.conv.K` 布局，**2D 单帧预览**，且**只配 ComfyUI-KJNodes `ModelPreviewOverrideKJ` 用**——正是我方那 7 处的用法)；**②时序版=madebyollin `taehv` 仓库 `safetensors/taeh3.safetensors` 22,709,752 B**、sha256 `4fd022bfcab08772fe0536b17ea1a3bbb5625be11e397868d1c5d891863d4c13`(**只在 GitHub 发布，HF `madebyollin/*` 无该件**)；HF 上的 `OzzyGT/taeh3`、`suanyu/taeh3-star7`、`t8star/Taeh3-Comfy`(含把 Kijai 件改名 `taeh3_2d_kijai.safetensors` 的重仓) 均为镜像，优先原作者直链 | **正解从"删引用"翻转为"补件"**：装 9.8 MB Kijai 件进 `ComfyUI/models/vae_approx/`(注意该目录**不在** `extra_model_paths.yaml` 映射表内)，则我方 **5 处 `taeh3.safetensors` 引用原地复活**(文件名与上游发布名**完全一致**，无需改任何 json)；剩 1 处 `MiniMax-H3-TAE.safetensors`=**把 repo 目录名误当文件名**，改指 `taeh3.safetensors`；第 7 处本就是 `none` 不动。装件要重启才刷新下拉 → 按 C8 并入对拍役单次重启；**fallback**(若用户不装)=6 处改回 `"none"` 走 Latent2RGB | 缺陷定谳保留=两机 `vae_approx` **目录为空**(Win 实列只剩 `put_taesd…` 占位)、该 widget 可选值实测只剩 `["none"]`(比翻目录更硬的指纹)；但**前轮"三枚名字两机都没有故无法补"的推论作废**——正名就在 HF。本役 E4 由此改为"两案候裁"(见 §三/§四 C16) |

### C 层：通用范式（设计层面可借）

- **潜空间对齐 + 少步重绘**是"提高成片分辨率"的另一条轴：他二采全部走 `LTXVSeparateAVLatent → MinimaxH3LatentUpscaler3D → LTXVConcatAVLatent → BasicScheduler(2-3 步, denoise 0.2)`，即**在 H3 自己的 latent 域里做放大与轻重绘**，与 1106 的 RelayVSR 像素域超分互补而非互斥——RelayVSR 管"清"，latent 轻重绘管"补细节"。可做的实验=同一素材两路对拍，不必换模型族。
- **`ManualSigmas` 起点即重绘强度**：他用 `0.85,0.725,0.4219,0`(三代)与官方 `0.909375,0.857143,0.666667,0` 都把"从多噪的位置接管"显式写死，比我方 `[219] "1, 0.7, 0.4, 0.0"` 的 σ=1 起点(等于全量重绘)更省步数、更保结构。这是一条**零成本口径**：③段若嫌结构漂移，先动起点别动 τ。
- **音频支线做成可插拔**：同一套 LTX 骨架，一代把音频支线保持直通、二代三代才接重编码——说明"要不要重生成声音"是可一键切换的拓扑选择。我方若要保留该开关，形态照此(支线级切换，非另存一份工作流)。
- **降分辨率是唯一的糊图解法反面教材**：他另一件 Note 明确写「画质糊的解法只有提一采分辨率，不是调 CFG；CFG=1 是蒸馏模型的正确配置，调高会过饱和/结构崩坏」——与我方 turbo/LMS 加速档 CFG=1 口径一致，可作外部旁证引用。

### D 层：不吸收（结论+理由）

| 件 | 理由 |
|---|---|
| `H3LTXAdapterLoader/Convert` + `models/h3_ltx_adapter` | 自研包无公开源、适配器权重本包未附；换域=再养一个 22B 模型族，与 1106 主力裁定反向 |
| LTX2.5 五件权重(22b transformer / gemma4-12b-with-proj / video VAE / audio VAE / taeh3-ltx) | 同上；且我方 Win `LTXV*` 核心节点虽在(0.44 自带)，缺权重即缺全部价值 |
| `XHLTXIdentityOverlap` + `Best_FaceID_v1.0_LoRA` 锁脸支路(三代) | 该 LoRA 无公开同名件；锁脸我方已由 `ComfyUI_InfiniteYou` + `ComfyUI_essentials` + `Comfyui_Resolution-Master` 覆盖，属重复建设 |
| `RTXVideoSuperResolution`(那 2 件里的 NVIDIA 原生超分) | Win 虽已注册，但 macOS 侧物理不可用；超分主力 1106 已定 RelayVSR Streaming(1.09-1.17 s/帧)，不换引擎 |
| `XHImageResizeV2` | 职责=图像缩放/比例对齐，`Comfyui_Resolution-Master`+`essentials` 已覆盖；且它属 XH 包(拿不到) |
| `XHLabel` / `XHTimer` / `XHGroupController` | in=0/out=0 纯装饰件(画布便签与计时)，装了不改结果；`XH_Toolbox` 里真正有信息量的只有 Adapter 两件 |
| `pika_h3_flex_fl2va_v1_avg_rank_56_bf16` | 我方 Win 已有 `pika_h3_flex_fl2va_comfy_bf16` 与 `pika_h3_flex_ref2va_comfy_bf16`(三段链 `[216]` 在用)，同族重复件 |
| `minimax_h3_taomate_3step_lora_avg_rank_19_bf16` | 我方 `[202]/[314]` 已挂 `taomate_h3_3step.safetensors`，同一功能 |
| `MiniMaxH3MemoryEfficientSageAttentionPatch` / `LTX2AttentionTunerPatch` | 小黑说明 §6 自己写明属**备用实验分支未接入执行链**，且与 A6"同模型勿叠注意力补丁"冲突 |
| `LTXVLatentUpsampler` / Win 现有 `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors` | 域不对(LTX latent)，在 H3 链上是死库存(它出现在 `MinimaxH3LatentUpscaler3D` 下拉里只是同目录扫描所致) |
| `GetNode`/`SetNode` 大量使用 | 我方裁定=画布零触碰、变量总线由 App 组装器承担；他的 `ResolutionSelector → Set → Get → target` 读法在我方落 `[206]` 显式 1280×704 已等价 |
| 夸克网盘分发形态 | 供应链不可控(件可被替换/改名，`taeh3_decoder.safetensors` 就是他的本地改名实例)；一律改指 HF 官方/原作者直链并核 sha256。**注**：1106 复查已证明其内容物绝大多数是 HF 正件的重打包(Kijai/stdstu123/Efficient-Large-Model)——**否的是分发形态，不是件本身**，所以三枚"缺口"现在都有合法直链可下 |

### 唯一真实空缺（记档，本役不做）

**「出片即响」**——8GB 本本机跑 20-40 分钟是常态，小黑链的计时件只是画布装饰，真正缺的是**完成事件的应用侧通知**。全仓实测 `apps/frontend` + `apps/backend/electron` 零 `new Notification` / 零 `playSound` / 零 `Audio(` 命中；钩子候选=[apps/frontend/components/orbs/use-task-center.ts:188](file:///Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/components/orbs/use-task-center.ts#L188)。已另立 Trellis 役 `11-06-render-notify`(P3)，不并入本役。

## 三、执行序（1106 grill 后定稿；本役只做 P0 零下载，实件全部移交对拍役）

| 档 | 做什么 | 归谁 | 门禁 |
|---|---|---|---|
| **P0-1 (E1)** | A1 TokenCounter 六格上限表：**payload-only 探针**(脚本现装 API prompt，run-to-node 只跑到计数件，走 TE 不采样)，测 0.4MP(864×480)/0.9MP(1280×736)/1.0MP(1376×768) × 33/96/192f，表追加进 `参数速查.md` | 本役 | **真源不加此节点**(C4/C9)；证据落 `apps/output/xiaohei-absorb-e1-1106/`(运行态不入 git)；引擎用户区零新增文件 |
| **P0-2 (E2)** | A2 `MiniMaxChunkFeedForward [2,4096]` 插 `[202]→[203]` 之间，出厂旁路位、默认不生效，开启条件写死 ≥2MP×192f | 本役 | **先跑旁路位语义探针**(C10)；不动 `[219]` 扇出(C2)；位置 x∈(5703,6563)、y≈80 落"二采放大"组框内(C5)；C11 四门全过 |
| **P0-3 (E3)** | A3 τ1.3 臂**只作候补臂行**追加进 `参数速查.md`，③组 `[313]` 现值零改动 | 本役(实跑归对拍役) | C3；`git diff` 自证 ③组未碰 |
| **P0-4 (E4)** | B4 悬空 tiny-VAE 引用：**本役不动 json**——原推荐"六处改 `none`"的前提(无合法件可装)已被推翻，现正解=装 9.8 MB Kijai 正件(见 P3)，改 `none` 降为 fallback；两案呈用户裁(C16) | 本役定案 / 对拍役执行 | 定案后若走装件案=随 P1/P2 单次重启(C8)，若走 fallback=纯 json 值改动、零重启 |
| **P0-5 (R5/R6/R7)** | 原件归档 + 清单核账注记 + 合规口径 | 本役 | 只追加不重排(C13)；skill zip 不入库 |
| **P1** | B1 refiner=**下 Kijai rank16 0.155 GB**(HF 正版、融合 qkv 命名已核，零转换工作)→ ②段 `[215]→[210]` 间插 `LoraLoaderModelOnly @1.0`，与 A4 官方 σ 表**同批**上(C1) | 对拍役 `11-06-xiaohei-absorb-duipai` | 官方 8.30 GB Diffusers 件**不下**(静默空转，C14)；挂载判据=引擎日志 `lora key not loaded`≈0；升档线=代理档不显著则停，显著但漂移才升同仓 rank384 5.87 GB |
| **P2** | B3 快速 VAE **三发同题**：现役件 vs 臂 A `lynnreal_light_vae_int8_convrot` 2.14 GB(可整替，含 encoder，~1.3×) vs 臂 B 官方 `fast_h3_vae_noncausal_24l` 6.47 GB(**无 encoder→须双 VAELoader 并存**，README ~9.4×)；臂 C `sol_vae_int8_convrot` 1.99 GB 作低成本候补同入矩阵 | 对拍役 | 判据=②段末 `VAEDecode` 墙钟 + 抽帧/SSIM；臂 A 另须验 `VAEEncode` 换件后画面一致性；门槛=解码墙钟 ≥3× 且抽帧无差才谈落位(C15) |
| **P3** | B4 taeh3=**装 9.8 MB Kijai 件**(`vae_approx/taeh3.safetensors`，文件名与我方 5 处现存引用逐字相同) + 把 1 处 `MiniMax-H3-TAE.safetensors` 误名改指 `taeh3.safetensors`；与 P1/P2 **合并为一次引擎重启**(C8) | 对拍役 | fallback=6 处改 `"none"`(本役原 E4 案)；两案候用户裁(C16)。每重启=一次引擎空窗 |
| — | A5/A6/C 层：随本档沉淀，不产生装机动作 | 已完成 | — |

## 四、执行门禁与冲突消解（C1-C16）

本轮 16 条冲突全部来自"我的推荐 vs 仓库既有法条/实测基线/上游事实"，逐条消解；**执行时照此，不得回退到拷问前原文**。其中 C9/C10/C11/C12/C14/C15/C16 七条推翻了我自己给出的推荐——推荐不是结论，探子回来才算结论。

| # | 冲突 | 消解后的口径 |
|---|---|---|
| **C1** | 推荐"②段改官方 σ 表"，而 `test_pika_three_stage_contract.py:95` 把 `[209]==["simple",3,0.2]` 钉成「UP 定谳」 | **无 refiner 时 `[209]` 一字不动**；官方 σ 表只在 B1 真挂上那一发同时生效，且**同批**改契约+写理由(σ 表与 refiner 是一副配方两半，拆开改=无据变更) |
| **C2** | 推荐"挂现有开关位"，而契约 `:236` 钉死 `[219]` 扇出恒等 `[218,221,222]` | **禁扩 `[219]` 扇出**；可选件用出厂旁路位表达，切换在画布/App 侧栏，不做第四枚 Seam |
| **C3** | τ1.3 臂要动 `[313]`，而 `test_stage3_tessera_params_v4` 钉 ③组全员 `mode=2`+双 LMS/taomate/×1.5/σ 表现值(=1104 1080p 终裁) | 臂**不进 ③组现值**；要跑就在探针 payload 上跑；赢了再单独提契约变更理由，不与本役混 |
| **C4** | A1 若落真源节点=与"形态③ 只做实测写表"自相矛盾，且触发契约/落位三连重跑 | **真源零改动**；App 侧机检门另立项(不在本役也不在对拍役) |
| **C5** | 新节点破布局铁则 | 契约三钉:`pos≥80`、恒向右、三组框两两不交。E2 新节点 x∈(5703,6563)、y≈80，落"二采放大"组框内(框=5673..10493) |
| **C6** | 说"在 Win 走 hf CLI"——Win 实探**无 huggingface-cli**(有 aria2c 1.37.0/git-lfs 3.7.1/无 HF_TOKEN)，且 `参数速查.md` 早有 1105「HF 大模型下载铁律」=优先 **Mac 直连**(unset 代理+HF_TOKEN+16 线程 curl 11-22 MB/s) | **不新造第二条下载路**：沿用 canonical `apps/build/scripts/fasth3_weights_fetch_1027.py` 口径(`curl -L -C -`→`E:\IP\tmp\…\*.part`→**体积+sha256 双门**→原子 `os.replace`→写 `.ok` 收据 JSON)，在该脚本内嵌表加行；下载在 Mac 走、Win 只收件；E: 余 931 GB。**注:`.ok` 是我方收据非 ComfyUI 加载必需**；孤儿 `.ok`(1105 归档遗留)另笔账 |
| **C7** | 1105「kitchen+sol-attn 勿拆对」vs ②段现链只挂 kitchen `[215]` 无 sol-attn | 事实核清:②段现 0.92MP 实弹已过，"裸跑炸"那雷发生在 **2MP×192f 全画幅**。门禁=对拍役把 ②段推到 ≥2MP 时**必须成对补 sol-attn**，不得以"②段现在没挂"为由裸推 |
| **C8** | "taeh3 装件并入 B3 一起重启"又把 B3 划给对拍役 | 分层:**本役 E4 只改 json 值(不需重启)**；对拍役装 B1/B3/taeh3 **合并为一次重启**(每重启=一次引擎空窗) |
| **C9** | 推荐"E1 在引擎家用户区临时探针件上跑"——**违落位规范**：`工作流落位规范.md:8-18` 行 2 明写引擎用户区**会话禁写恒零**(只有用户画布 Save 可写)，且 `plugin_manager.py:1430/1520` 使 `repo:` 真源在引擎侧物理不可写 | **改为 payload-only 探针**(脚本现装 API prompt，不落任何工作流文件)，与"分镜域零实体"同一口径；证据落 `apps/output/`(运行态不入 git) |
| **C10** | 推荐"旁路走 mode=4 与 `[9]` 同家机制"——但 `[9]`/qi21 的 mode=4 件都不在 MODEL 主线，③组主线件用的是 mode=2；两数值在本引擎 `graphToPrompt` 的行为差异(**直通 vs 整件剔除**)未证 | **执行前先做旁路位探针**：以 payload 提交体实测"默认状态下 `[203]` 能否拿到 MODEL"。mode=4 不直通→退 mode=2 并在契约注记；两者皆不安全→**不 splice 进主线**，改在探针 payload 测(同 E1 手法)，真源留"设计已定谳、落位待契约为可选件开位"记档。**不许猜数值上线** |
| **C11** | 推荐门禁"layout_check 必过"**已不可能**——基线实测三段链 = **crossings 590(上限 0)+48 occlusions，exit 1**(结构判据干净)；且 `workflow_gate.py:69-73` 的 `WORKFLOW_TARGETS` 只含三件 qi21，三段链交叉数**有意不入棘轮** | 门禁改写:**结构判据保持 clean**(负区/左向/重叠/est 四项)+ **crossings 不得比基线 590 恶化**(改前后两数都记)+ `pytest test_pika_three_stage_contract.py` 全绿 + `node apps/build/scripts/canvas_deploy.mjs --audit` 指纹门 |
| **C12** | 前提"写进真源=每章都吃"不成立——App 逐镜组装走**构建期内联件** `apps/frontend/lib/assist/image-studio/pika-ref-shot-template.json`(28 节点，md5 前缀 `7204e…`，pre-1105 分叉，无②③段)，真源三段链 88 节点(md5 `5cffb…`)，两者只由 `pika_ref2va_mainline_1101.py:44-45` 手工 byte-sync 过一次 | **E2 改真源=只影响手工画布直开与该件契约测试，不改逐镜产线**。E2 默认旁路故不必同步内联件；"产线生效"须另议 byte-sync 内联件(届时同步 `h3-shot-video-workflow.test.ts`)，本役不做。附注:`storyboard-pipeline-comfy.ts` 的 `MAINLINE` 实为 6 键(+`assets`=7 槽位)，"恒7环节"说法与代码不同步——只记不擅改(属并发会话域) |
| **C13** | 共享文档已有**并发会话在途**:`参数速查.md`(qi21 加速子图 LoRA 臂手术)、`分镜H3视频产线.md`、`my_qi21_speed_select.py`、`qi21-道劫-*.json`、`test_qwen21_workflow_contract.py`、`face_qc/`+`speech_vad/` 簇 | 本役所有共享文档改动=**只追加不重排不改他人 hunk**；仅在用户下令提交时 `git diff` 复核只含本役 hunk；E1 token 表新节追加在 `参数速查.md` 末尾，避开在途编辑点 |
| **C14** | 三层冲突叠加：①我推荐"起手直接下 `Rkss` rank64 0.99 GB"；②头文件实探证明**官方** refiner 是 Diffusers 键名，挂我方融合 qkv 基座=逐键丢弃的**静默空转**(比报错更坏)；③而前轮"HF 全网零命中、三枚件 provenance 不可核"本身又是**检索方法错误**造成的假结论 | **定谳链**：官方 8.30 GB Diffusers 件**不下**(要它必须自写改名+qkv 融合转换脚本，且 pruned/hybrid 基座行为未验——不值得)；**下 Kijai rank16 0.155 GB**，其头文件实测就是 comfy 融合命名(`diffusion_model.blocks.N.attn.qkv_proj.lora_A/B`，metadata 自证 `converted_layout: comfyui_minimax_h3` + `source: Efficient-Large-Model/Open-H3-Regenerate-2K`)→ **零转换、体积最小、来源正版**三样全占。**挂载有效性硬判据**=引擎日志 `lora key not loaded` 计数≈0(铁律10)，Kijai 件每模块附带的标量 `.alpha` 未知键只算告警噪声(alpha 已折进 `lora_B`) |
| **C15** | 我推荐"B3 快速 VAE 与现役件对拍换件"——头文件实探证明官方 `fast_h3_vae_noncausal_24l` **无 encoder、无 quant_conv**(297 tensor，`encoder` 计数 0)，`VAEEncode` 走它会 AttributeError | **按件分形，不是一刀切**：臂 B(官方 fast)=**必须双 `VAELoader` 并存**，编码支路恒留现役件、只末段 `VAEDecode` 换件(否则 `vae.py:963` AttributeError)，换来 ~9.4× 解码；臂 A(lynnreal int8 2.14 GB，1106 复查=HF 在架且**含 encoder 116 键 + quant_conv**)可**整件替换**、链形态零改动，但只有 ~1.3×。两臂与现役件三发同题，判据=解码墙钟 + 抽帧/SSIM，臂 A 另须验换编码器后的画面一致性；门槛 ≥3× 才谈落位 |
| **C16** | 我推荐"E4 把 6 处悬空 tiny-VAE 引用改回 `none`(前提=补件无合法来源)"——复查证明那 5 处引用的文件名 `taeh3.safetensors` **与 Kijai 上游发布名逐字相同**，合法 9.8 MB 件就在 HF；`none` 方案会把一处"缺件"误治成"删功能" | **正解翻转为补件**：装 `Kijai/MiniMax-H3-TAE` 件(9,791,388 B，sha256 `f0f60fa0…`)进 `ComfyUI/models/vae_approx/`(该目录不在 `extra_model_paths.yaml` 映射内)，5 处引用**原地复活、不必改任何 json**；第 6 处 `MiniMax-H3-TAE.safetensors`=把 repo 目录名误当文件名→改指 `taeh3.safetensors`；`none` 案降为 fallback 候用户裁(时序版 madebyollin 件只在 GitHub 发布，而 KJ 预览件此处用法配 2D 枚，故起手取 Kijai 2D) |

## 五、排查方法备注

- 引擎 API 一律 `curl --noproxy '*'`；不带就 exit 7 假离线(本轮亲历，见 §一 附带纠错)。
- 端口现查禁抄常量：Mac 走 `grep '"port"' <home>/manifest.json`(实测 17001)，Win 直连 192.168.0.101:17000(实测 0.44.0)。
- 双机分工实勘：**H3 权重全在 Win**(`E:\IP\漫影工作室\comfyui\models`，由 `extra_model_paths.yaml` 映射；Mac 侧 `models/` 只有 qwen/krea 图像件，`unet`/`vae`/`latent_upscale_models` 均空)——本役所有落位/对拍默认在 Win。
- **同名≠同件，同件必核 sha256**：B2 的定谳靠 Win `Get-FileHash` 对上 HF LFS `sha256`，一步省掉 0.69 GB 下载与一次误装；反过来小黑的文件名不能当 inventory 证据。
- **同件≠同用：核到键名层**。sha256 只能证"是不是同一份字节"，证不了"挂得上"。本轮第二层零下载定谳=**HTTP Range 抽 safetensors 头文件**(读 0-8 B 小端长度 → 解 JSON 头，几 MB 封顶)看键名与 metadata，据此判出：官方 refiner 键名域不匹配(静默空转)、Kijai refiner 融合命名可直挂、官方 fast VAE 无 encoder(只能纯解码)、lynnreal int8 有 encoder(可整替)。**推论：任何"下个大件再试"的计划，先花 1 秒抽头文件**。
- **静默空转比报错更坏**：ComfyUI 对未命中键只逐条打 `lora key not loaded` 警告后照常出片——判据必须是**读引擎自己日志的该计数**，不能是"跑通了/出图了"(铁律10)。
- `MinimaxH3LatentUpscaler3D` 的 `model_name` 是"目录扫描"(实测下拉含 LTX 死库存件)，故下拉里有 ≠ 链上可用。
- `ModelPreviewOverrideKJ.tiny_vae` 可选值=`["none"]` 即 `vae_approx` 为空的直接指纹，比翻目录更硬。
- 8 个 json 的 Note 正文才是真清单源(模型名+网盘直链+LoRA 用途自述+装包纪律)，比 `.txt` 说明全；排查同类材料先抽 Note 再抽节点。→ **更正计数：实为 6 个 workflow json**(1106 逐件 `json.load` 复核节点数 67/76/76/75/77/45；前文所有"8 件"系把 skill 件混入计数所致)。
- **widget 里的目录前缀是 provenance 线索，顺着它重查就能翻案**：他三枚"网盘-only"件在 widget 里写成 `H3\Kijai\<file>`——1106 顺着这个前缀复查，**三枚全部 HF 正版在架**(见 §一 纠错第四条：Kijai rank16 0.155 GB / Kijai lynnreal int8 2.14 GB / Kijai taeh3 9.8 MB)。教训写死：**HF 按文件名的全站文本检索不可靠**(前轮"零命中"正是它的产物)，正解=`/api/models?author=<x>` 列仓 → `/api/models/<repo>/tree/main?recursive=true` 取文件清单比名 → 再抽头文件验内容。
- 官方配方一手源：`huggingface.co/Efficient-Large-Model/Open-H3-Regenerate-2K`(README + `lora/lora_config.json` + `MERGE_VERIFY.json`，合并件=refiner 384/384 + LightX2V turbo v1.2 128/8 + LMS Sharp v1.0 r64，312 linears，matvec 相对误差 2.2e-8)；其 `sharp_curve_branches` 依赖 `Comfy-Org/MiniMax-H3` 的 `minimax_h3_ref2va_pruned_int8_convrot` 里按字节区间读的 `adaln_t_table`(1025×8)，而该件 1105 已归档(`Win` 只剩孤儿 `.ok` 标记) → 想碰 curve branches 得先归档件回迁，故不入可吸收清单。

## 六、合规口径(MiniMax H3 Community License，1106 读原文 84 行)

本役与对拍役装的每一枚 H3 系件都受该证约束，故口径写死在此，不在执行时临时判断：

- **地域**：Applicable Territory=全球**除去** EU / UK / 韩国 / 美国(§I.3、§I.5，§V.4 禁止在适用地域外使用/复制/修改/分发)。我方双机在中国境内 → 落在适用地域内。
- **授权面**(§II)：非独占、不可转让、免许可费，允许"使用、复制、分发、创作衍生作品(含 Model Derivative)、修改"；§I.11 的 Model Derivative **明确涵盖蒸馏/权重模式迁移**——即 taomate/LMS/pika/Rkss 这类加速 LoRA 与二次量化件本身是受本证约束的 H3 Works(官方 refiner LoRA README 亦自证继承本证)；§VI.1 声明衍生品归衍生品作者。
- **使用限制**：§V.3 **不得**用 H3 Works 或其**输出**去改进任何其他 AI 模型(H3 自身及其衍生品除外)→ 我方若将来拿成片喂任何模型训练/微调，属违约，须先回问用户；AUP#12 要求对外发布的机器生成内容**显著披露**，AUP#19 禁军事用途。
- **分发**：§III 修改过的文件须带显著声明，分发须随附 NOTICE("MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax. All Rights Reserved.")；商用产品须显示 "Powered by MiniMax H3"(§III.2a、§IV.2)；年营收 >$20M 须事先取得 `api@minimax.io` 书面授权(§IV.1)。**故：权重一律不随 App 打包、不转发、不分发**(与 R7 同口径)；§VII 对输出不授 IP 许可、MiniMax 亦不主张输出权利(§VI.4)；争议管辖=香港法院(§VIII.2)。H3 文本编码器内含 Qwen3-VL-32B(Apache 2.0)，另有一层署名要求。
- **结论**：**仅本地自用产线**完全落在 §II 授权内，无营收/展示义务；一旦涉及"对外发布成片""随安装包分发""用成片训练别的模型"三件事，先停手回问用户。

## 七、P0 执行收口（1106 实做；本节为执行期证据，与前文冲突处以本节为准）

本役(P0 零下载)四格的实做结果与**执行期纠错**。真源改动只有**一处**：`pika-单镜视频-三段链.json` 由 **88 节点/134 链 → 89 节点/135 链**(`last_link_id` 754→755)；库件数、域分类、侧栏、清单计数全部零变化(全树仍 114)。

### E2 ChunkFFN 削峰件 —— 已落真源，四门齐过

- 落位：`[223] MiniMaxChunkFeedForward` 插 MODEL 主线 `[202]→[203]`，链 606=`[202].0→[223].0`、链 755=`[223].0→[203].0`(MODEL)；`pos=[6543,80]`、`size=[300,90]`、`widgets_values=[1,4096]`(chunks=1 / seq_threshold=4096)、`inputs` **只留 model 口**(widget 走 `widgets_values`，与同行 `[202] [640,90]`/`[203] [265.5,82]` 同风格；若把 widget 塞进 `inputs` 会被 est 估高 196 px 而判行距违规)。
- **C10 定谳(探针前疑问由源码直接消解，无需实跑)**：`minimax_nodes.py` 的 `MiniMaxChunkFeedForward.execute` 头两行就是 `if chunks == 1: return io.NodeOutput(model)` —— 恒等返回**同一个 model 对象**，不重建、不包装。故"默认不生效"靠 **chunks=1** 表达，与 mode=4/mode=2 的旁路语义之争无关；prd C10 那条"直通 vs 整件剔除"的分支**整条作废**(不是被实测推翻，是被更简单的出厂恒等位取代)。开启条件仍是 **≥2MP×192f**(切 chunks=2)。
- **执行期纠错 1(C5 走廊)**：文档原写"新件落 x∈(5703,6563) 组框内"，实测那条走廊只有 **220 px** 宽而新件声明宽 300 → 按原口径必压 `[203]`。正解=新件占 `[6543,6843]`，让位集 `TAIL_IDS=[203,215,210,211,212,214,4,100,213]` 整体 x+600，"二采放大"组框宽 4820→5420。
- **执行期纠错 2(让位集不能用 x 区间自动判)**：最初用"落在 tail x 区间内"筛让位件，误吞了 y 288..930 行的 `[205][206][207][208]` —— 它们与新件**不同行**，一动就外扩三根曲线(205→206 / 205→207 / 208→210)，crossings **590→592 破棘轮**。改为脚本内**显式件号**+ `[207]` 单独向下 nudge 25 px(与新件列距 60<80 的 est 违规) → **589**。教训：让位集是拓扑判断不是几何框选，必须写死件号并可回检。
- 门禁结果(C11 改写后的四门)：契约 `test_pika_three_stage_contract.py` **13 用例全绿**；结构判据(负区/左向/重叠/est)**clean**；crossings **590 → 589**(不升反降 1)；`canvas_deploy.mjs --audit` 只剩"装机与真源漂移"这一条预期红(本轮打包覆盖安装即收)。改前后两份 layout_check 原文 + before/after UI json 在 `apps/output/xiaohei-absorb-e2-1106/`。
- 脚本=`apps/build/scripts/campaigns/xiaohei_absorb_e2_chunkffn_splice_1106.py`，幂等：已落位时按 `HEAD_POS + SHIFT` 回检让位量，不符**只报红不覆写**；`--check` 出 READY 摘要。
- C12 口径不变：改真源只影响"手工画布直开 + 该件契约测试"，**不改逐镜产线**(内联件 `pika-ref-shot-template.json` 走构建期内联，未同步；E2 默认旁路故无须同步)。

### E3 τ1.3 候补臂 —— 已注记，`[313]` 与③组零改动

- 臂表追加在 `docs/comfyui-kb/参数速查.md`「③组 sol-attn τ 候补臂」节，字段名与语义取 Win 引擎 `/object_info/BlockSparseAttention` 实读值：τ **现值 1.5 / 臂 1.3(=上游 default)**，方向是**更密更慢更保真**的保真臂，不是加速臂(1.0 精确保留 ~16% 键块 / 1.5 ~7% / 2.0 ~2.7%)；另记 `start_percent` 现值 0.0 vs default 0.2、`dense_blocks "0,1"` vs `""`、`min_tokens 12288`/`extra_tokens 256`、sink `exact_kv_and_rows`、`verbose false`。
- **执行期纠错 3(C3 证据口径)**：prd C3 写"契约把③组现值钉死"——实核 `test_stage3_tessera_params_v4` 钉的是全组 `mode=2` + `[303]`×1.5 + `[319]` σ 表 + `[317]/[318]` sampler + 三枚 LoRA 档 + 底模/TE + `[305]` 若干 + `[336]` 前缀/CRF12，**`[313]` 的 τ=1.5 并未被逐值钉**。裁定不变(零改动)，依据更正为"1104 终裁画布现值 + 无实弹理由不动参数"。`git diff` 自证：③组任何件未出现在改动里。

### E4 悬空 tiny-VAE 引用 —— 定档=案一(补件)，本役 json 零改动

**执行期纠错 4(计数口径更正)**：前文与 prd C16 写"6 处"，逐件 `json.load` 全库重数后的准确账是 **8 处站点 = 6 可救 + 2 不归本案**：

| 站点 | 现值 | 处置(案一) |
|---|---|---|
| `2_固定线/社区-480P生成-960P精修-SolAttn加速-960P直出.json [17]` | `taeh3.safetensors` | 装件后**原地复活，零改 json** |
| `2_固定线/社区-480P生成-SolAttn加速-480P直出.json [17]` | 同上 | 同上 |
| `4_官方本地模板/H3-首尾帧运镜版.json [6]` | 同上 | 同上 |
| `6_社区模板/社区-480P生成-960P精修-SolAttn加速-SeedVR2超分2K.json [17]` | 同上 | 同上 |
| `6_社区模板/社区-480P生成-潜空间放大到960P.json [17]` | 同上 | 同上 |
| `6_社区模板/社区-H3终极三采v2版.json [224]` | `MiniMax-H3-TAE.safetensors` | **改一个 widget 值**即活(把 repo 目录名误当文件名) |
| `6_社区模板/社区-H3三采6步lora完美版.json [728]` | 类型 `MiniMaxH3PreviewOverride` | **不归本案**：该类型 Win `object_info` 零命中=节点未注册，属缺包另案 |
| `8_吸收归档/单镜视频 · chapter-001 · S01.json [17]` | `none` | **不动**：归档件本就 `none`(且 `[17] widgets=[1024,80,True,9,12,'none','']`)，双理由 |

- **装件目的地的坑(执行期新证)**：`vae_approx` **不在**双机 `extra_model_paths.yaml` 映射表内，且 Win 侧 `ComfyUI/models/vae_approx/` 只有一个 0 字节 `put_taesd_encoder_pth_and_taesd_decoder_pth_here` 占位；Mac 侧同样未映射。故案一的落位目录=引擎本体 `models/vae_approx/`，Win `tiny_vae` 下拉实测只剩 `["none"]`(=目录空的硬指纹，比翻目录更硬)，装件后**必须重启**才刷新下拉 → 按 C8 随对拍役单次重启批执行，本役不动 json。
- **双机 kjnodes 版本账(执行期新证)**：Mac HEAD `37ca7aff7ed14dde6ba3c0b25713e21c18b28dcb`、Win HEAD `ab72eda7ffad6280422d71ab7d54d3fb87c0ba18`(不同)，但 `nodes/minimax_nodes.py` **blob 逐字同**(14,861 B，sha256 `c67d638cd1f060ff…40cb91b`，末次提交 `da90cca8`；差异只是 Win CRLF / Mac LF)→ E2/E4 涉及的 schema 双机一致；`[223].ver` 取 Win 产线值。

### E1 TokenCounter 上限表 —— 十格全绿，表已入 `docs/comfyui-kb/参数速查.md`

- 探针=`apps/build/scripts/xiaohei_absorb_e1_token_probe_1106.py`(payload-only，符合 C9：引擎用户区**零新增文件**，证据只落 `apps/output/xiaohei-absorb-e1-1106/`)。dry-run 实测：三段链转 API prompt **86 件**(转换器跳过 3 件纯 UI MarkdownNote)，接计数件后闭包剪枝恒 **12 件** `['9','14','16','110','111','112','113','119','120','128','900','901']`，**采样件混入=0**(这是"不会把三枚 SaveVideo 全产线跑起来"的硬证)。
- **执行期纠错 5(两处非猜不可的技术前提)**：①`MiniMaxH3TokenCounter` **不是 OUTPUT_NODE**，直接 run-to-node 它会被 `validate_prompt` 判 `prompt_no_outputs` → 必须挂一枚 `PreviewAny` 读它的 `breakdown` 口(输出 3)作唯一出口，并用 `partial_execution_targets=[PreviewAny id]`(引擎 `server.py:1198-1204` 支持)；②客户端必须自己做闭包剪枝，否则整条产线进队。
- **十格全绿(1106 19:18–19:21 实测，exit 0)**：0.4MP(864×480)/0.9MP(1280×736)/1.0MP(1376×768) × 33/96/192f + 2MP(1920×1056)×192f 对照，逐格 `status=success`、`WARNING` 全空，表已 `--write-doc` 追加进 `docs/comfyui-kb/参数速查.md` 末节(只追加，未碰他人 hunk)。顶格 **130,076 tokens=43.42%**，最低 8,966=2.99%；读数五条(两墙分账/帧数线性/text 项被参考占位主导/参考项≈面积×张数)写在该表下，本档不重复正文。
- **执行期纠错 6(int32 警告线数值)**：早先笔记与脚本注释写的「`2**31 // 7168 = 268,435`」是**算错的**——`2**31//7168 = 299,593`，源码口径见 `comfyui-kjnodes/nodes/minimax_nodes.py:275-276`(`seq_len*7168 >= 2**31`)。表内百分比一律按 **299,593** 计；任何沿用 268,435 的旧账都要按新数复算(差 11.6%，不影响"从不贴顶"的结论)。
- **执行期纠错 7(门禁两处，复跑必知)**：①**参考图 widget 值不可直接提交**——真源 `[9]/[110..113]` 的 `widgets_values` 是 App 组装期才落地的**占位名**，磁盘无件，直接提交被 `validate_prompt` 判 `HTTP 400 Invalid image file`(首轮十格就死在这)。修法=payload 内换成引擎 `input/` 目录**真实存在**的生产代表件，并在提交前逐件 `HEAD /view?type=input` 验在位；②**显存门不能钉绝对值**——本探针跑完第一格后 TE/VAE 被 ComfyUI 缓存常驻，24G 卡 `vram_free` 由 18,432 掉到 7,609 MiB，绝对门 18,432 会把**自己**判成"他人占卡"而永远等不到窗口。现行=显存门取 `min(--min-free-mib, 自家基线−1,024 MiB)`(基线=开跑前实测 free 与各格跑完 free 之最小值)，`/queue 0/0` 仍是硬门；③`_post` 必须把 `validate_prompt` 的响应体读出并抛出，否则只剩一句 `HTTP 400`，无从诊断(本轮实弹踩到)。
- **引擎用户区零写入双机实测(C9 自证)**：Mac 引擎家 `user/default/workflows` **0 件**(计数不变)；Win 家 6 件、1106 当日 **0 改**；Win 装机侧只动了 `resources\backend\comfyui\workflows\…\pika-单镜视频-三段链.json` 一枚(非用户区)，改前备份在 `E:\IP\tmp\pika-单镜视频-三段链.pre-1106e2-20261106-192029.json`(md5 `ea2af13f…`)。

### 交付与双机同步收口(1106 晚，用户令「打包覆盖安装，并且同步 Mac 与 Windows 机器」)

- **打包链(唯一入口 `apps/build/packaging/build-mac.sh`，`MANYYING_ALLOW_APP_LAUNCH=1`)**：electron-vite build exit 0 → electron-builder exit 0 → 覆盖安装 → `app.asar` 哈希核验 `3a6af400…2860d287c` → installed smoke 全绿(`output/automation/desktop-smoke-report.json`：routes=6、workflowE2E / assetVoiceFlow / scriptAssetGenerationVoiceFlow / pluginSettings 均 ok、whiteRatio=0.000) → open-verify 经 Launch Services 起得来并正常退出。**链首预检两次拦下"App 正在运行"**：一次是本人后台命令的管道写法(`| tail -60`)吞掉了真实 exit code，一次是**用户真人实例在前台**——不动手强杀，改由用户令「我优雅退出它再打包」后走 App 自身退出路径，再重跑整链才过。教训入档：**长链命令禁接管道**，否则预检失败会被伪装成成功。
- **四副本最终账(本役唯一改动件 `pika-单镜视频-三段链.json`)**：
  | 副本 | md5 | 结论 |
  |---|---|---|
  | 仓库真源 `apps/backend/comfyui/…` | `32852470f358fcb33597b8b86707ade4` | 基准(89 件/135 链) |
  | Mac 装机 `…漫影工作室.app/Contents/Resources/backend/comfyui/…` | 同上 | 打包即收 |
  | Win 装机 `E:\IP\manying-studio\resources\backend\comfyui\…` | 同上 | 单件 scp 推送，远端复读 `nodes=89 links=135 groups=3`、`[223]`= `MiniMaxChunkFeedForward` `pos[6543,80]`/`size[300,90]`/`widgets[1,4096]`/口只剩 `model` |
  | Mac 引擎用户区 | 无副本 | NOTE(零回灌基线，非漏) |
- **Win 侧走位说明**：`deploy-dual.sh` 本役**不适用**——A1 段要求工作树干净、Phase A 含 `git push`，两条都在用户「未令不提交」的边界外，故改走**单文件 scp + 双端 md5 复验**(Win 动作全程持 `win-control-lock.sh` owner=`11-06-xiaohei-h3ltx-absorb` L2)。Win `workflows` 树计数仍 **114**，与本清单口径一致。
- **`canvas_deploy --audit` 装后 FAIL(4) 归因(不代跑他人)**：四条全在**并发会话 qi21 域**——`my_nodes/nodes/my_qi21_speed_select.py`(引擎家 md5 `7747a156…` 落后仓库 `992243a9…`，仓库改于 14:34、引擎家停在 14:28) + 三件 `my_nodes/subgraphs/qi21-道劫-加速子图{,-edit,-i2i}.json`(引擎家**无副本**，仓库 15:14 新建)。这些文件本役零接触(见 git status 同批 `M`)，其生效动作归其本人；**本役件在 audit 里只有 NOTE 一条**，无 FAIL。对齐 298 路 / NOTE 114 条。
- **Win 机锁**：E1 与同步验数跑完后 `win-control-lock.sh release --owner 11-06-xiaohei-h3ltx-absorb`，不留过夜锁。

