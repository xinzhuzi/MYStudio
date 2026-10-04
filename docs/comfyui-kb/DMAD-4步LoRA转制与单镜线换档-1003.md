# DMAD 4步 LoRA:转制配方与单镜线换档(2026-10-03)

> 状态:**用户 1004 预授权字面条件命中(全热对墙钟更快,崩坏级/音频不可用级两条例外均未触发)→ 单镜视频线已换 DMAD 默认档**(2026-10-04 落地:`[41]/[8]/[42]` 三改 + `[48]` 开态核验原样,换档后验证脚本 PASS;BlockCache 开态 sanity PASS)。
> **1004 用户终局裁定:SolAttn + DMAD(4步)定为 Mac 生成视频的主力配置**。裁定依据如实记:质量面(rank-128 原版蒸馏 vs 旧件 rank-28 缩水)+音频面(响度健康)的稳定优势,墙钟面「不劣+偶发收益」(全热对快 16.35% 系现状臂单发 437s 异常迭代主导,稳态单迭代无可测差,见 §1 稳健性警示——勿传「稳定快 16%」);其余 5 条 v1.1 引用线迁移与旧件删除另裁,8step 11 条线不动。
> 战役档:`.trellis/tasks/10-03-dmad-h3-4step-lora/`(PRD/设计/执行流水 + `verdict-draft.md` 预审报告 v2);对拍产物原始数据 = 任务档 research/ 与 `/tmp/dmad_ab/out/run_log.jsonl`、`/tmp/dmad_ab/sanity_out/run_log.jsonl`。

## 1. 一句话结论

- **换档**:全热对墙钟 1292.4s→1081.1s,DMAD 快 211.3s(16.35%),预授权判据字面命中;单镜线真源(仓库 1 件)已换 DMAD 默认档,4step v1.1 旧件**暂不删**(另有 5 线激活引用,迁移后另行清件)。
- **BlockCache 开态 sanity**:PASS(`dmad_bc_s42_full` status ok、墙钟 1158.5s 与关缓存发同量级、音频面貌一致、引擎日志零 BlockCache 报错)——`[48]` 保持生产开态,无需改关。
- **稳健性警示(必读,防「稳定快 16%」误传)**:全热对墙钟差由现状臂单个 437s 异常迭代主导(超差贡献 252s > 总差 211.3s),两臂稳态单迭代速度无可测差(<2%,方向偏现状臂),且全热对 n=1——「换档后生产稳定快 16%」**不成立也不宣称**;换档的本质收益在**质量面**(rank-128 原版 vs rank-28 缩水 + 官方 σ 网格/音频 shift 口径)与**音频响度面**,墙钟面至多「不劣」。
- **人耳复核项(用户)**:DMAD 臂音频比现状臂响约 20dB(机检零旗标,但响度是实质可闻差异),建议听一遍 sanity 产物 `/tmp/dmad_ab/sanity_out/dmad_bc_s42_full.mp4`(详见 §4)。**→ 1004 用户人耳终审通过(「声音可以」),响度项收卷**。

## 2. DMAD 是什么(来源与口径)

- 论文 arXiv 2610.02188《DMAD: Distribution Matching as Adversarial Distillation for Fast Visual Generation》(Texas A&M + 字节跳动作者;HF 仓库为一作个人号 `ZhengmingYu/DMAD`,非字节官方 org)。
- 权重正源:`https://huggingface.co/ZhengmingYu/DMAD/resolve/main/minimax_h3/dmad_minimax_h3_4step_full_critic.safetensors`(full_critic 变体,AVGen-Bench 得分高于 critic 主版;1.4GB / 1383674320 字节;下载件 SHA256 `ac23eaef3a359666610769e4ef5f8af9530262c265f25ac211b0b54e51efc91e`,2026-10-03 实算)。
- 官方推理口径:`--steps 4` / `--video-shift 12` / `--audio-shift 2` / 无 CFG(guidance 已蒸馏)/ 默认 re-noise 步进;**只声称 T2V**——本线 I2V 属越界用法,靠对拍实测裁决。
- 许可:代码 Apache-2.0;权重为 MiniMax H3 Community License 派生物。

## 3. 转制配方(为什么必须转、怎么转、怎么验)

### 3.1 问题

DMAD 原版命名对 q/k/v 各一对 `(down_i, up_i)`(分离式);本机基座 `minimax_h3_fl2va_pruned_bf16.safetensors` 把 qkv 存成融合块 `qkv_proj [out_q+out_k+out_v, in]`。**引擎硬约束**:`comfy/lora.py:389-393` MiniMaxH3 分支仅剥 `diffusion_model.` 前缀直映、无 qkv 分离→融合展开(Flux 在 lora.py:278-279 有此先例,H3 没有)——分离式输出会被**静默丢弃**,融合式是唯一可行形态。norm 键凑数不可行(DMAD 未训 norm,1 维权重打 2 维 LoRA shape mismatch)。

### 3.2 融合数学(精确无损,零近似)

```
down_fused = concat([down_q, down_k, down_v], dim=0)    # [3r, in]
up_fused   = block_diag(up_q, up_k, up_v)               # [3·out_total, 3r] 稠密存(含零块)
Δ_fused    = up_fused @ down_fused == concat([Δ_q, Δ_k, Δ_v], dim=0)   # 逐块精确相等
```

- 体积代价:qkv 的 up 部分 3× 膨胀(零块),整件 1.4GB → ≈1.95GB(实测 1956172424 字节),与在役 8step 件同量级。
- `out_proj` / `fc1` / `fc2` / token_refiner 各模块**直接改名搬运,零数学变换**。

### 3.3 键映射表(两侧实读对齐)

| DMAD 键(分离) | ComfyUI 目标键(融合) |
| --- | --- |
| `transformer_blocks.N.attn.to_q/.to_k/.to_v` 的 down/up | `diffusion_model.blocks.N.attn.qkv_proj.lora_down/up`(经 §3.2 融合) |
| `transformer_blocks.N.attn.to_out.0` | `diffusion_model.blocks.N.attn.out_proj` |
| `transformer_blocks.N.ff.net.0.proj` | `diffusion_model.blocks.N.mlp.fc1` |
| `transformer_blocks.N.ff.net.2` | `diffusion_model.blocks.N.mlp.fc2` |
| `token_refiner.refiner_blocks.N.*` | `diffusion_model.token_refiner.blocks.N.*`(同构) |

### 3.4 208/312 口径(执行期定谳,防混淆)

- 转制输出的**朴素模块键 = 208**(52 块 × 4:qkv_proj/out_proj/fc1/fc2;50 transformer + 2 refiner),与在役 turbo 4step 件 416 tensors 完全同构;
- **加权可适配位 = 312**(源 DMAD 的 312 个分离模块全收编,qkv_proj 一键计 q/k/v 三路);
- **机器校验门按 208 精确结构集判**(静态键校验:转换后键集剥前缀 ⊆ 基座键集)。
- 键风格:`lora_down/up`(Kohya 首选,`comfy/weight_adapter/lora.py:159-172` 第一优先);无 alpha 键 ⇒ scale=1.0(`weight_adapter/lora.py:248-251`),配 strength 1 ⇒ 有效强度 1.0。
- qkv 拼接顺序默认 `q,k,v`;GQA 维度断言 + `--qkv-order` 换序兜底——本件 q/k/v 三头同维 7168,维度无法锁序,默认 qkv 一次过,**未触发换序**(0.2MP 预检即为此风险买的保险,两臂均非崩坏)。

### 3.5 脚本与产物

- 转制脚本:`apps/build/scripts/dmad_lora_convert_1003.py`(幂等/`--dry-run`/维度断言/数值等价自检(抽 1 块 block_diag==分离,fp32 验证)/静态键校验;数学与键映射唯一真源=任务档 design.md §1/§2)。
- 产物:`<引擎家>/models/loras/dmad_minimax_h3_4step_full_critic_comfyui_bf16.safetensors`
  - bytes:1956172424;**SHA256:`ab92f1c7e3e96b8bbdf2c2419ea2f19f86f1bc2de40a9b1477409f0b9808e057`**(2026-10-03 实算,2026-10-04 落账时引擎件复算逐位一致)。
- 瘦身后手(未做,留档):SVD 把融合块压回低秩(lightx2v `resized_avg_rank_28` 即此类手术,属近似);长期驻留再评估。

## 4. A/B 对拍结果(单镜视频线 · I2V · 1344×768/73 latent 帧)

**口径**:节点参数 `length=73` 是 latent 帧数(17×4+5);VAE 解码后实际渲染 **124 帧@24fps=5.167s**(四发 `ffprobe -count_frames` 实测均 124)。同提示词同首帧同种子;现状臂=turbo 4step v1.1 rank-28 原样,DMAD 臂=换件+严格 4 步+audio shift 2;两臂 BlockCache 同关、SolAttn 同留。

| 项 | 现状臂(turbo 4step v1.1 rank-28) | DMAD 臂 | 判 |
| --- | --- | --- | --- |
| 首帧遵循度 MSE[0,1](输出第1帧 vs 输入首帧) | s42 0.001636 / s137 0.001608 | s42 0.001701 / s137 0.001687 | 劣化 **+3.97% / +4.91%**,界 11% → **过**(呈报项,非停用条款) |
| 结构相似 SSIM | 0.8233 / 0.8224 | **0.8235 / 0.8232** | DMAD 两种子均微高(+0.0002/+0.0008),结构未劣化 |
| 音频 sanity(时长/采样率/非静音/max_volume) | 5.167s/32kHz/100%/−41.2dB~−34.9dB;mean −57.9/−55.6dB 触发 `too_quiet` | 5.167s/32kHz/100%/−21.5dB~−15.0dB;**零旗标**(mean −40.0/−34.1) | **否决级未命中**(DMAD 臂静音/破音/失真/不同步四查全过) |
| 墙钟(全分辨率单发) | 全热对 **1292.4s**(s137) | 全热对 **1081.1s**(s137) | DMAD 快 211.3s/**16.35%** → 预授权判据命中(稳健性见下) |
| 资源粗峰值 | 采样期粗常驻 ≈60GB / 128GB 统一内存 | 可计量面无差(同 UNET/编码器/VAE 加载行) | —(LoRA 补丁瞬态日志未计量,如实声明) |
| 种子集与结论 | {42,137} 两种子墙钟与护栏同向 | 同左 | 无分歧 → Q6 不扩种(`seed_extension_triggered:false`) |

**逐发明细**(驱动侧 `/tmp/dmad_ab/out/run_log.jsonl`,10-04 落账时在盘逐行核对):

| 发 | 臂·种子 | 墙钟 s | 首帧 mse[0-255] | 音频 mean/max dB | 旗标 | 字节 |
| --- | --- | --- | --- | --- | --- | --- |
| ① | base · s42(**冷启动发,不计入墙钟结论**) | 1232.7 | 69.6 | −57.9 / −41.2 | `too_quiet` | 6,710,812 |
| ② | dmad · s42(热) | 1021.9 | 72.0 | −40.0 / −21.5 | 零 | 7,414,576 |
| ③ | base · s137(热) | 1292.4 | 68.22 | −55.6 / −34.9 | `too_quiet` | 7,002,436 |
| ④ | dmad · s137(热,**全热对**) | 1081.1 | 71.51 | −34.1 / −15.0 | 零 | 7,834,024 |

预检(0.2MP 608×352,种子 42):base 330.8s / dmad 195.2s(快 40.99%);mse 134.41 vs 140.13(劣化 4.26%);base 触发 `too_quiet`(mean −62.0dB)、dmad 零旗标(mean −37.7dB)——与全分辨率面貌一致。交叉口径:驱动侧 0-255 尺度劣化 s42 +3.45%/s137 +4.82%,与判读工具 [0,1] 尺度两套独立工具方向与量级一致,劣化稳定 3-5% 区间。

**墙钟差的分解(稳健性呈报,判读员忠实呈报非新增判据)**:

- 四发采样均为 4/4 次迭代——两臂同为 4 次模型前向(现状臂=8 步 simple 调度 + SplitSigmas(4) 截断网格取前 5σ、产物链消费 x0 预测;DMAD 臂=4 步完整网格终 σ=0),**墙钟差不可能来自步数减少**。
- 全热对差 211.3s 构成:采样内差 +238s = 现状臂 s137 的 it2 单点异常(437s vs 185s,+252s)+ 其余三迭代合计 −14s(现状臂反微快);非采样段 −26.7s(方向偏现状臂,疑与 LoRA 件 394MB vs 2.1GB 补丁应用量差相关,日志无直接计量)。**剔除单点异常迭代后两臂无可测速度差(稳态差 <2%)**。
- s42 对的差 100% 来自现状臂冷启动第 2 暖机迭代(+136s),本就不计入结论。

**BlockCache 开态 sanity(转正前补发,堵「A/B 关态比、生产开态跑」口径差)**:**PASS,`[48]` 保持生产开态**。证据=`dmad_bc_s42_full` 发(`sanity_out/run_log.jsonl`):status ok、墙钟 1158.5s(与关缓存 dmad_s42 1021.9s 同量级,非数量级劣化)、时长 5.167s、音频 mean −40.0/max −21.5dB(与关态发一致)、mse 72.0(同值)、7,414,822 字节;引擎日志 `engine_ab_1004_sanity.err.log` 零 BlockCache 报错、run 完成 `Prompt executed in 00:19:14`(仅存 2 处 Traceback 均为启动期 kjnodes triton 缺失噪音,10-04 复核归因)。

**加载验证**:引擎日志 lora 告警 `grep -icE "lora.*(not found|skip|warn|unknown)"` r1/r2 两轮均 **0 命中**;UNET 38445.40MB 四发均同值全量加载 + 摘要行 `LoRA: dmad_… ×1.0` = 无静默丢弃的行为证据;312 加权适配位全收编(口径见 §3.4)。

**音频面如实呈报三点**(详细归因见任务档 verdict-draft §2.2):

1. `too_quiet`(mean<−45dB)旗标命中在**现状臂**全部三发(预检+s42+s137),本役样本内一致——现状臂过静是该臂基线面貌,非 DMAD 劣化;DMAD 臂响度更接近引擎在档健康存量件(H3_480P_00002_.mp4 复测 mean −21.5dB)。
2. 两臂音频响度差约 20dB(DMAD 明显更响),属实质可闻差异;工具测不出刺耳失真/嘶鸣/口型同步——**人耳复核为必做项**(建议听 `/tmp/dmad_ab/sanity_out/dmad_bc_s42_full.mp4`,并与现状臂产物对比),人耳不过走 §7 回滚。
3. 换档对下游(混音响度基准/口型)的影响本役未测,归人耳复核范围。

**控变量机检**:引擎日志 `[MY出图][全量JSON]` 四发字段级比对——臂间差异**恰 4 处**(`[41] lora_name`、`[8] steps 8→4`、`[42] shift_audio 3→2`、`[4] filename_prefix`),种子间差异恰 2 处(noise_seed+产物名);提示词/首帧/分辨率/帧数/采样器/SolAttn 全参逐项相同,BlockCache 两臂同缺席(=同关)。design §3 手术面零偏差。

## 5. 判读依据(为什么算赢)

- **采用判据(用户 1004 预授权,替代 Q3 建议权)**:任务档三处书面记载(prd.md 关键决策表「1004预授权」行、prd.md R5、design.md 判读规则 1)口径一致——**「测试墙钟更快(全热对口径)即采用 DMAD,赢分支免终审等待;崩坏级/音频不可用级命中=预授权失效」**。实测全热对快 211.3s → 字面命中;两条例外均未触发(崩坏门四发 status ok/124 帧/SSIM 0.82/零异常栈;音频否决级 DMAD 臂零旗标)。
- **护栏(首帧遵循度劣化≤11%)是呈报项不是停用条款**:两种子 +3.97%/+4.91% 过线;超界也不停用、如实呈报供终审裁量(预授权原文无稳健性条款、无最小幅度门槛)。
- **种子分歧(Q6)**:两种子结论同向(墙钟与护栏均一致)→ 不扩种。
- **口径声明(读数折扣)**:①euler 等价模式,非论文 re-noise 步进(论文数字有保真折扣);②DMAD 官方口径 T2V,单镜 I2V 属越界用法,官方未背书;③首帧=同镜头 K2 线变体自备图(`input/manying-shot-h3-sb-chapter-001-001.jpg`,768×432,SHA256 `70bd581f512997fc9d20bad113bd60cca1700535cf21db3c67ac9fe271647aaa`,非 H3 原版首帧,两臂同图控变量;度量时视频帧 LANCZOS 1344×768→768×432 含轻微各向异性形变,两臂同法公平但绝对 MSE 含该分量);④两臂步数语义:同 4 次前向下「截断网格 rank-28 turbo」vs「完整网格 rank-128 DMAD」,PRD 的「8→4 提速一半」不在本役结论内。

## 6. 装机口径(引擎家资产,装机不播种)

- DMAD 件住**引擎家** `models/loras/`(`~/Library/Application Support/漫影工作室/comfyui/models/loras/`),与 turbo 件同位;**装机机制不播种权重**(engine_manager 只建目录结构,含 loras)——新机/重装须手动放置(件名+SHA256 见 §3.5),否则单镜线 `[41]` 加载报缺件。
- 引擎家 git 恒 0 改动(models 非 git 管),引擎侧资产=手动运维面。
- 换档后的单镜线工作流参数(真源=仓库 `2_视频/H3视频/1_漫影自研/0_单镜视频/单镜视频 · chapter-001 · S01.json`,10-04 落账时逐字段核验在位):`[41]` DMAD/strength 1;`[8]` simple/**4**/1(`[3]` SplitSigmas 4 全表透传不动);`[42]` 12/**2**;`[48]` BlockCache 生产开态(sanity PASS 后保持,七参 0.12/0.08/0.95/2/cpu/8/true 原样);SolAttn 留;euler;1344×768/73 latent 帧。**双轨 widget**(positional `widgets_values` + `widgets_values_named` 两轨同改,件名恰 2 处、steps/shift_audio 各两轨)。
- **继承机制(S6 已核,留警)**:该真源是单镜线唯一模板;`rg "单镜视频|0_单镜视频|manying-shot-h3" apps` 仅命中展示锚注释与文档脚本,**未找到组装器硬引用**——新镜头/新章是否自动继承新档取决于漫影 App 组装器克隆注入路径,本役未获代码级证据;若各镜头另有用户区拷贝需另行盘点同步。
  - **〔勘正 1004 审计〕上条「未找到组装器硬引用/唯一模板」结论有误**:组装器硬引用实为 `apps/frontend/lib/assist/image-studio/MY-h3-shot-template.json`——`h3-shot-video-workflow.ts:3` `import templateJson from "./MY-h3-shot-template.json"`,当时 rg 关键词(单镜视频|0_单镜视频|manying-shot-h3)未命中该 import;「唯一模板」断言仅对库内样本成立。前端模板截至 10-04 仍为 4step v1.1(同文件另含 4step v1.0 字串)未换 DMAD——**换档若要覆盖运行时(漫影 App 单镜直开路径),须另行手术前端模板**,本役换的仓库样本件不生效于该路径。
- **引用地图(1003 实测更正版,10-04 换档后复测)**:4step v1.1 在仓库曾有 6 文件 11 处引用(单镜 1 + 固定线 2 + 社区模板 3 含 TTS 子图)——旧「1 件 4step + 11 件 8step」为字串计数误归;换档后余 **5 文件 9 处**(固定线×2 各 2 处、潜空间放大/超分2K 各 2 处、TTS 子图 1 处,10-04 `rg -o` 逐件实测),全部不动;旧件处置见 §7。

## 7. 回滚口径(旧件暂不删凭据 + 回滚步骤)

- **旧件现状(10-04 落账时实测)**:`minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_resized_avg_rank_28_bf16.safetensors`(394MB/393,791,328 字节)**引擎位在位未删**——另有 5 线激活引用(§6 引用地图),直接删即断 5 条线(含 2 条固定产线),故暂不删;处置方向=5 线逐一 A/B 后迁移再清件(PRD R5 原文「余 5 线迁移后另行清件」,另立小役)。
- **外置盘副本已验**:`/Volumes/郑冰津/AI/H3/loras/` 同件在位(2026-08-22 装机当日即同份归档),SHA256 `c139f5201aa6cc09d545caf83241b4174dfe328c8084352470ba74201c2ef2fb` 双侧(引擎侧+外置侧)2026-10-03 实算一致、10-04 落账时外置侧复算仍一致。「先收」完成;manifest 行与删除凭据**未落**(删除未执行,模板见任务档 `s6-win-prep/archive-manifest-draft.md` §4/§5,届时照走)。
- **回滚步骤**(若 DMAD 档出问题要退回 turbo v1.1):①工作流 git 回退(当前未提交:`git checkout -- "apps/backend/engines/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/单镜视频 · chapter-001 · S01.json"` 即回 turbo 档;已提交按批次 revert);②引擎无状态残留(LoRA 按件名逐发加载,改回件名即回原行为;旧件在位未删,立即可用);③DMAD 件可留(不碍事)或按输分支口径先收后删(外置盘收档路径建议见任务档 `s6-lose-prep/archive-list-draft.md` §2);④KB 落账同步更正 + 如实报用户(预授权失效条款)。8step 线全程未动,不受影响。
- **人耳复核不过 = 预授权例外条款回溯生效**,按上述回滚;音频面若推翻,T2V 官方口径两发可作补充证据通道另立(不预承诺,用户点头才跑)。

## 8. 联动落账记录(10-04 落账时同步,防台账漂移)

| 目标 | 实际动作 |
| --- | --- |
| `docs/comfyui-kb/LoRA库存台账.md` | 行 22(4step v1.1)建议更新为「单镜线已换出、引擎件保留未删(5 线引用未迁移)」+ 引用数 10→8(换档后复测口径);**新增 #27 行**(DMAD 转制件补登);行 23(8step)不动 |
| `docs/comfyui-kb/漫影工作流清单.md` | 单镜视频条目补 LoRA 档口径(DMAD 4step/strength 1/audio shift 2/严格 4 步,1003 换档) |
| `docs/comfyui-kb/参数速查.md` | 未改:4step/dmad 件名字串零命中;仅存 2 处通用 turbo 口径行(0.2 测试档 09-14 实测史/turbo 步数行),不涉本役件名,若后续新增单镜线 LoRA 段落再同步 |
| 任务档 | S6 收尾流水在主会话;pathspec 提交(不含 `.trellis`)= 主会话收尾执行,本役不 commit |
