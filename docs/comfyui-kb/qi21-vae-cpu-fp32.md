# QI21 参考链 VAE 严重偏棕：本机 CPU＋FP32 修复

> **选型结论（2026-10-24）：本机已验 QI21 参考链保留 `VAELoaderKJ`＋`device=cpu`＋`weight_dtype=fp32`；仅改 FP32 不够，不能从权重文件名中的 `bf16` 推断运行 dtype。**

## 故障是什么，原因已知到哪一层

CPU 指用处理器执行 VAE；FP32 指 32 位浮点精度；MPS 是本机 Mac 的 GPU 计算后端。**设备和精度是两项独立选择**：本次验证的是 CPU＋FP32 组合，MPS＋FP32 仍失真。CPU 方案可能更慢，这里优先保证图像正确。

BFS 换头输出曾出现严重棕灰浮雕纹理；保存默认的道劫 i2i 也出现灰棕失真。`history success` 仅表示请求执行成功，不表示参考颜色或换头质量合格。

在**不含 BFS、文本编码器（TE）和采样器**的原图 VAE 编码→解码重建中，同一张原图、同一个 VAE 文件已经复现失真。KJ 加载器保持同为 FP32，只把 `device=main_device`（本机 MPS）改为 `cpu`，重建即恢复正常。因此本次严重失真的因果定位终点是**本机当前 Qwen-Image-2.1 VAE 的 MPS 执行路径异常**，不是 BFS 仅支持真人、提示词或后期调色造成的结论。

**尚未知：**具体 Metal/PyTorch 层、底层算子及其触发条件未定位；不声称已证明某个算子缺陷，不泛化为所有 MPS 设备或所有 VAE 都有问题。

## 同图、同文件、同 FP32 的设备隔离证据

下表来自[原始 MPS VAE 诊断记录](../../.trellis/tasks/archive/2026-10/10-22-bfs-qwen21-color-diagnosis/research/face-ab-1023/mps-vae-diagnosis.md)。MAE 比较原始 RGB，数值以 255 为尺度，不以调色后的预览计算。

| 重建条件 | prompt_id | RGB MAE | 观察 |
|---|---|---|---|
| 默认加载路径，原图 VAE 重建 | `66246e12-8b56-49a4-9307-8b1b7f3d1949` | `111.6706/255` | 严重失真 |
| 同文件，KJ MPS FP32 | `f208f0b1-ba98-4731-881b-9b460ef84be7` | `111.6546/255` | 严重失真，单改 FP32 未修复 |
| 同文件，KJ CPU FP32 | `63e561dc-a8c1-4a03-a14f-13d7b471fb26` | `0.9069/255` | 视觉正常 |

原图 RGB 均值约 `[200.86,195.91,189.08]`；CPU 重建约 `[200.58,194.98,188.71]`；MPS FP32 约 `[120.57,103.26,67.85]`。这里证明的是已验设备路径差异；没有据此宣称 CPU 上任意 dtype 都通过。

## 如何修复，哪些部分保持不动

| 项 | 已验设置 |
|---|---|
| 加载器 | `VAELoaderKJ` |
| `vae_name` | `texture_fix_vae_for_qwen_image_2.1_bf16.safetensors` |
| `device` | `cpu` |
| `weight_dtype` | `fp32` |
| GUI 位置控件 | `["texture_fix_vae_for_qwen_image_2.1_bf16.safetensors", "cpu", "fp32"]`，与 `widgets_values_named` 一致 |

`bf16` 是文件名的一部分，**不是当前运行精度**；运行选择以加载器显式 `weight_dtype=fp32` 为准。CPU 与 FP32 是本次已验组合，两项都须保留，不把修复简写成“提高精度”。参考编码和输出解码必须共用此 VAE，不能只改其中一端。

只将 VAE 编解码放在 CPU；**不迁移 UNet、TE 或采样到 CPU，不改模型文件、LoRA、提示词、seed、采样参数或现有连线**。这不是全模型 CPU 运行方案，也不是性能优化承诺；本次知识固化不新增性能测试结论。

## 已验证工作流范围

| 仓库真源 | 加载位置与边界 |
|---|---|
| [qi21-bfs-换头.json](../../apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-bfs-换头.json) | 节点 `485`；同一 VAE 接编码 `496`（link `774`）与解码 `487`（link `754`） |
| [qi21-道劫-i2i.json](../../apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json) | 根节点 `3`；保留既有消费者，参考编码与输出解码共用 |
| [qi21-edit.json](../../apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-edit.json) | 根节点 `3`；保留既有消费者，参考编码与输出解码共用 |
| [qwen21-道劫-i2i-api.json](../../apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json) | 从现行 i2i 生成的 API 模板，`graph["3"]` 保持同一加载器及三项输入 |

范围只到上述已验 QI21 参考链；**不推广到其他 VAE、t2i、FLUX、H3 或 SeedVR2**。修复实施依据见[默认图生图 VAE 修复计划](../../.trellis/tasks/archive/2026-10/10-16-qi21-defaults-install/research/vae-cpu-repair-plan-1024.md)，保存默认及安装分层验收见[本线最终验收矩阵](../../.trellis/tasks/archive/2026-10/10-23-qi21-character-poster-type/research/final-ac-matrix-1024.md)；本页不替代原始请求、history、事件与 PNG 证据。

## 2026-10-27 当前工作流补漏

当前源码核查发现两条此前未纳入 CPU 防回归清单的参考流：[严格经典 img2img](../../apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-img2img.json)和[裁片换脸](../../apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-换脸-局部重绘.json)。两者的节点 `3` 已补齐同一 texture_fix VAE、CPU＋FP32，参考编码、实际底图编码及解码共用。原 i2i/edit/BFS 的配置仍保留；不能因旧四件通过就认定后续工作流也已经覆盖。

经典 img2img 另有独立的潜码接线错误：**当前官方 `TextEncodeQwenImage21` 第三输出是匹配首图尺寸的全零潜码，形状为 `[1,64,H/16,W/16]`，并非首图经 VAE 编码的内容。** denoise=0.6 的保构图精修必须由 `[16]` 的底图经新增 `[4021] VAEEncode` 接入采样器；参考条件仍接文本编码器。采样按位/按名两份存值同时固定为现行 9 步、cfg1、euler/simple、denoise0.6，防止载入时恢复旧的25步/denoise1。

裁片换脸先修正 VAE 扇出边重复登记、CONDITIONING/IMAGE 槽类型和 `resize_source` 名称，`[41]` 改为实际裁片 VAEEncode，缩回 `divisible_by=1` 防止176被截成160。首次真实出图证明整块224×176矩形即使16px羽化，仍会覆盖头发和背景；现行修复已改为脸内椭圆 `[81]`＋2px形状羽化 `[82]`，同一 mask 同时接 `[84] SetLatentNoiseMask` 与 `[70]` 像素回贴。裁片及脸内mask坐标都须随身图调整；本流不自动定位人脸，也不承诺终稿质量。

机器门：`test_qi21_reference_vae_cpu.py`、`TestQi21Img2ImgContract` 和 `test_qi21_local_face_contract.py`；现行手术入口为 `qi21_img2img_repair_1026.py` 与 `qi21_local_face_mask_repair_1027.py`（`qi21_local_face_repair_1026.py` 为前序修复，勿在新图上重跑），均位于 `apps/build/scripts/`。两条图已经通过真实前端 `loadGraphData → graphToPrompt` 与 live object_info 对拍；`apps/output/ai-workspace/ai/qi21-frontend-export-1027/` 是前序导出，最终证据以 `apps/output/ai-workspace/ai/qi21-frontend-final-export-1027/` 为准。结构、装机字节一致和真实出图质量分开验收，不以导出成功代替人脸相似度判断。

**输入绑定也须现查：**原输出目录下的同名身图已经变更尺寸，原人脸文件已不在原路径。此次测试绑定引擎输入区的 `yl-bfs-body.png` / `yl-bfs-head.png`，SHA256分别为 `2d9a2237b9a3e2b290c250cd892735fb768e8777681c6929a1926d380753e50c` / `dcddb7bd62e0e03d2a8b80460f78b642cbaccbe9596d0d5ea7eecc6416b17d8a`，与1023原始两图证据一致。禁止只凭旧路径或同名文件复用验收结论。

## 2026-10-27 透明参考黑底与局部遮罩

这与 MPS VAE 偏棕是两条独立故障。原人脸 PNG 是 RGBA，透明区的底层 RGB 大量为黑色；ComfyUI `LoadImage` 分别输出 RGB 和 `1-alpha` 遮罩。只接 IMAGE 参考会把黑 RGB 带入条件。现行 `[88] GetImageSize` 取得参考实际宽高，`[85] EmptyImage` 建同尺寸白底，`[86] InvertMask` 恢复不透明度，`[87] ImageCompositeMasked` 合成后才接 `[13]` 缩放与双图编码。换文件时不再假定参考为2048方图。

失败样本 `daeb6c5e-a139-4944-a6ff-79fb8367bd1c` 已出现第二图五官，同时带入光头与黑框，证明“第二图没有生效”的判断不成立；执行成功也不能算视觉合格。其裁片外变化为0像素。随后隔离试验 `ae2d7c98-3968-448c-b365-649d061d2d0b` 保持 seed42、20步/CFG1/denoise1，仅增加透明参考处理与脸内遮罩：黑框/光头覆盖消失，头发与背景保留，脸部变化5287像素（边界x588–664、y131–221）。面部仍比原图平涂，不能声称画风融合全部通过。

经典 img2img `3d2fe1d7-9102-45f2-9e30-06452fb972a2` 按保存的9步/denoise0.6执行，保留姿态、服装轮廓和主要构图，未见旧棕灰浮雕。它只有一张参考，不承担双图身份换脸验收。

收据位于 `apps/output/ai-workspace/ai/qi21-acceptance-1027/`，每案保留请求、匹配prompt_id的history/事件、原始PNG与逐图观察。前两案验收工具因 PNG 自动缓存字段误拒，原 `failure.json` 保留，并新增 `supplemental-verification.json`：LoadImage缓存须等于绑定输入SHA；MyQi21DaojieBase缓存须等于已核数据文件mtime签名；该底座数据SHA/mtime是事后补验，原请求提交前未绑定，不能追写成提交前已核。执行输入仍逐字段严格比较，未因此重发原请求；现行验收工具已在prepare阶段绑定后续请求的底座数据SHA/mtime。中间修复的历史前端证据另存 `qi21-frontend-mask-export-1027/`，不覆盖早期导出；该版本尚未修复下述白底控件占位，最终证据以 `qi21-frontend-final-export-1027/` 为准。

正式保存图增加动态尺寸后执行成功：`2ee0457a-2bab-4984-8fbf-9e7226b5061c`，收据目录 `203ff4fb6e71464fb33219f737baf708`，脸内变化仍5287像素，遮罩外变化0。最终前端校验进一步抓到 `EmptyImage` 的宽/高转连线后仍占 `widgets_values` 两个位置；省略它们会使画布的 `color` 回落黑色，虽然按名转换的API仍为白色。现行存值补齐 `[512,512,1,16777215]` 占位（宽高实际由连线决定），与 named 同步。`qi21-frontend-final-export-1027/` 的真实前端执行图已与上述成功请求完全相等，仅剥离展示用 `_meta` 并统一独立输出前缀，不需要重复投同一张图。契约已加入该按位存储反例；engines最新781通过，手部离线7项和单次验收工具15项通过。

## 完整链结果与艺术质量边界

- BFS CPU seed42：A 自换 `3e1788a4-6774-4d9b-be31-f3f4714c2a80`，B 基准换头 `1e897c99-8e7c-460c-bf12-e8f59e7214aa`；棕灰浮雕消失，B 的参考五官明显迁入。seed42/43 两组插画 A/B 完成状态以最终验收矩阵为准，不把早期诊断记录中“等待 seed43”误读成当前状态。
- 因而严重偏棕**不能用于判定 BFS 仅支持真人或动漫域限已判死**；但两张插画的头部迁入也不等于所有画风和身份保持都已验证。B 是整头诊断，会迁移参考发型/风格，不承诺只换脸、保发型或精修终稿；局部回贴的脸部平涂感仍是质量限制。
- 保存默认 i2i `b3d7448e-22bf-4750-a605-e1b790b7f8e9` 与 edit `a82c5bf2-ac19-409c-893d-6421c0d86135` 的历史验收已记录颜色正常。edit 默认任务是换云雾远山背景，并非换脸，不据此声称第二图身份迁移或像素不变。**2026-10-24 当时**另有“指令提 image2、衣服图片被旁路”的限制；**2026-10-26 源码复核已变化**：i2i 的第二图 LoadImage `[11]` 为 mode0，经 `[17]` 接入 `MyQi21FastEncode [4015].images.image_2`。`[17]` 的 mode4 仅旁路缩放，仍传递图片，不得把旧限制当作当前故障。
- 重建正常、整链执行成功、参考迁入、颜色正常、艺术质量分别验收；不把任一层通过扩大为全链所有质量目标通过。1024知识固化当时未重新发图；1027两条补漏流的真实出图、前端与装机验收另见下文，不能混用时间口径。

## 历史归因更正

旧记录中的“紫底”“提示词”“BFS 非真人域限判死”“VAE 往返是废码”等判断，属于设备隔离之前的历史推断，不作为现行诊断结论；保留原文和失败收据，不覆盖历史。色彩锚、洗底或校色可能属于独立美术处理，但**不能替代本次 VAE 执行路径修复**，也不能用校色预览掩盖原始 RGB 重建误差。

MPS 长期运行退化/空片是另一个问题，不能与这里同图同 VAE 重建已复现的色彩失真混为一条因果链；本页没有证明两者共因，也没有证明 CPU VAE 修复能解决所有空片。

## 未来恢复 MPS 的复验门

1. 在用户已授权的测试范围内，确认共享双队列均空，串行执行；本页只规定复验方法，不额外授权安装、重启或附加调试器。保留现行 CPU＋FP32 基线及失败证据，使用独立测试副本，不直接覆盖保存默认。
2. 记录本机版本、同一输入图与 VAE 文件哈希，用不含 BFS/TE/采样器的同图同 VAE 重建做设备 A/B：保持同一加载器和 FP32，仅换 CPU/MPS。保留 prompt_id、实际请求、history、输出与原始 RGB MAE，并看原图；必须消除严重偏棕/浮雕，定量对照 CPU 基线，不能只看调色图。
3. 重建通过后，再以相同输入、相同 seed 和其余冻结参数复验完整受影响链：BFS 插画自换/基准换头 A/B、拟恢复的 i2i/edit。分别记录颜色、参考迁入及艺术质量；单次重建通过不等于保存默认已修复。
4. 设备重建和同 seed 整链都通过后，才可在用户授权范围内恢复对应保存默认；已获授权的安装件更新走唯一 `build-mac.sh`，逐层核对仓库/构建/装机资源，不能热拷贝 `.app`。契约保持见[ComfyUI integration 的两项 CPU VAE scenario](../../.trellis/spec/backend/comfyui-integration.md)。
5. **不凭版本升级、`history success` 或非黑/非空像素认定修复**。未通过上述复验前继续保留 CPU＋FP32；不得把本机试验结果扩展成其他模型的默认设备规则。


## 2026-10-27 最终分发与选型记忆

最终两图源码、构建件与装机资源SHA一致；installed smoke于 `2026-10-26T18:18:43.423Z`（北京时间10月27日02:18）通过，fresh node-graph审计284路对齐、98条零回灌NOTE、零漂移。app.asar双向一致值为 `92c73f331931a9759273f3a955d892eca6ae269ec1d8f63a8d85e0abcfe83e90`。这些是本轮时点证明，后续仍须现核，不能只凭历史哈希认定最新。

分发快照、独立审查与保留的首次安装失败见[1027收口报告](../../apps/output/ai-workspace/ai/qi21-closeout-1027.md)；最终分发补充收据为 `apps/output/ai-workspace/ai/qi21-final-installed-proof-1027.json`。装机后live object_info已确认两图所用节点与cpu/fp32选项齐全。最终GUI执行图导出在安装前已验且与成功请求等价；未主动重载用户已有标签页，不承诺旧画布内存已替换。

Codex已新增1027记忆note，ZCode既有 `qi21-vae-cpu-fp32-1024.md` 与MEMORY索引已补最新两流、零潜码、透明参考/mask和GUI按位占位规则。**下一次选型先读本页，再核当前JSON与live object_info；旧四件通过不等于后续参考流已覆盖。** 本轮工程修复与分发完成，局部脸仍偏平涂，`visual_all_pass=false`，不把执行成功或同步完成当作终稿艺术质量通过。
