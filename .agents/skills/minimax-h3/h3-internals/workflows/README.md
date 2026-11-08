# workflows/ — UP 主 SevnFading 三套工作流原件存档

> **⚠️ 置顶声明（用户裁定 2026-11-07，永久有效）：这三套工作流是 UP 主在其机器与需求下的一种选择，
> 并非肯定最优。** 存档 ≠ 采用。本仓产线以自己实弹验证的配方为准（出音频成片 = 28 步纯净 bf16 唯一
> 标准档；三段链 Turbo 8 步+B2+TaoMate 终态），本存档不构成对产线的任何替换依据。挂载/对拍/换产线
> 须用户明确指令。

## 来源与取件链路（全程可溯）

- 视频：<https://www.bilibili.com/video/BV1Cq4h6aERN>（2026-11-05，见上级 `../README.md`）
- 评论区置顶 → 飞书文档《MiniMax-H3 工作流底层原理详解》（用户登录态读取，2026-11-08）→ 1.3 节
  夸克网盘 `pan.quark.cn/s/1cad690998b3`（目录「MiniMax-H3教学 所有工作流的底层原理/工作流/」）
- 取件：quark-direct-dl 管线（客户端登录态 API），只取 3 个 JSON（共 ~126KB），**盘内 75GB+ 模型件
  未下载**。原件缓存 `~/Downloads/1107-h3-principles-video/quark-workflows/`
- 同内容 RunningHub 帖（UP 发布位，带 inviteCode=rh-v1455）：
  全能参考视频 <https://www.runninghub.cn/post/2115413934902702081> ·
  SelfLift二采 <https://www.runninghub.cn/post/2117192175418175490> ·
  低显存兼容 <https://www.runninghub.cn/post/2117222656276783106>

## 三件套（canvas 格式，ComfyUI 0.4 schema）

| 文件 | 节点数 | 定位 |
|---|---|---|
| `【MINIMAX-H3教学】全能参考视频.json` | 20 | 官方范式基础版：UNET→SamplerCustomAdvanced 一次采样，零加速件 |
| `【MINIMAX-H3教学】SelfLift二采.json` | 24 | +LoraLoader +H3SigmaRefiner +SelfLiftH3Sampler（二采主力） |
| `【MINIMAX-H3教学】SelfLift二采（低显存兼容）.json` | 29 | +BlockSparseAttention +ModelAttentionBackend +SagePatch +LowVRAMAttention +ChunkFeedForward（全加速栈） |

## JSON 本体解析定谳（2026-11-08，python 解析原件；推翻/补正此前帧证据推断）

1. **真 LoRA = `dmad_minimax_h3_8step_full_critic_comfyui.safetensors` @ 1.0**（8 步 DMD 蒸馏，盘内
   1.95GB）。视频 frame_0013 里的 `minimax_h3_fi2v_lightx2v_turbo_4step_v0.1_comfy` 是**录屏时的旧
   变体**，发布包已换 8 步 DMD——口播「8 步加速 LoRA」与发布包一致，帧证据就此作废（D2 终裁）。
2. **低显存版「KJNodes 切块节点」真名**：`MiniMaxLowVRAMAttention`（参数=切分数，1=不切）+
   `MiniMaxChunkFeedForward`（切分数 + 4096）——即视频口播的"两个切块节点"（此前未验尸，现已由原件
   定名）；同栈还带 `MiniMaxH3MemoryEfficientSageAttentionPatch`（Sage 真身在此，进一步坐实
   ModelAttentionBackend ≠ sage）。
3. **官方核心注意力节点实参**：`BlockSparseAttention` = sol-attn / tau 1.3 / start 0.2 / end 1.0 /
   min_tokens 12288 / sink exact_kv_and_rows；`ModelAttentionBackend` = **comfy kitchen attention**
   （INT8 后端，与我方 0.44.0 源码验尸一致）。
4. **默认 UNet = `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8`**——即班长系社区 b25-49 层拼接件
   （本仓 1104 已知档案），非 ref2va_pruned_int8（后者是下拉备选）。UP 的三套全部走参考生视频线。
5. **latent 放大器引用 `minimax_h3_latent_upscaler_3d_fp16_V2.safetensors`**（V2 fp16）——盘内
   models/ 只装了 `3d_conv_v1_bf16`（690MB）与 `h3_upscaler_lms_v0.1_fp32`（1.38GB），**V2 件盘里没有**，
   采用时需另行获取（疑在 HF LBH-123-AI 仓）。
6. 其余实参：MiniMaxH3ReferenceToVideo 1344×768/124 帧/max；KSamplerSelect=euler；
   BasicScheduler=sgm_uniform（steps 槽被 PrimitiveInt 接管：1st=7、2nd=4）；
   H3SigmaRefiner=[1, 0.7, 0, cosine]（与帧完全一致）；
   SelfLiftH3Sampler=[cfg=1, lowres 0.5, rho=0（纯二采）, w 0.5–1.0, tiling off, unload on]。
7. **另两件补抽（2026-11-08 二轮）**：
   - `全能参考视频.json`：UNet=ref2va_pruned_int8（官方件），**零 LoRA 零加速**；采样=res_multistep +
     **simple/4 步**（存档原值，无步数覆盖 primitive——与视频自己「官方 20 步」的叙事不一致，按原件
     如实记录）；参考尺寸=**match**（SelfLift 版是 max）；画幅 0.7MP（SelfLift 版 1.2MP）。
   - `SelfLift二采.json`：核心与低显存版逐项一致（同 hybrid UNet / dmad LoRA / 7+4 步 / SigmaRefiner /
     SelfLift 全参数）——低显存版=此件再叠 5 个模型级补丁节点。
   - 三件共用同一支演示提示词（产品广告 `Editorial cinematic technology product commercial. Use
     <Picture 1> as the exact opening frame...`，参考图2=mecha_dragon_lightning.png）。

## 与本仓的关系

- 知识层拆解见 `../04-SelfLift节点与主流工作流.md`（帧证据）与 `../05-模型级加速与低显存.md`；
  本 README 第 5 节的定谳已回写 `../06-与现有技能交叉核对.md` 与 `../../reference.md`。
- **模型件永不因本存档下载（用户令 2026-11-08：吸收的是知识，不是模型）**。盘内 dmad LoRA /
  hybrid UNet / V2 放大器等只在上方作为「引用事实」记录；插件包（SelfLift/YCNodes/KJNodes）同理
  只留仓库指针（facok/comfyui-SelfLift、yichengup/ComfyUI-YCNodes-MiniMax-H3、kijai/KJNodes），
  双机引擎均未装、不装。
