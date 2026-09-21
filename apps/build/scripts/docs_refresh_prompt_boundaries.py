"""Separate evolving prompt workflows from dated experiment records."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[3]
TASK=ROOT/'.trellis/tasks/09-20-docs-current-alignment'
records=[]
def edit(p,pairs):
 old=p.read_text();new=old
 for a,b in pairs:
  assert new.count(a)==1,(p,a[:65],new.count(a))
  new=new.replace(a,b,1)
 sha=hashlib.sha256(old.encode()).hexdigest();backup=TASK/'backups/final'/sha[:12]/p.relative_to(ROOT)
 backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,backup)
 assert p.read_text()==old
 p.write_text(new);assert p.read_text()==new
 records.append({'path':str(p.relative_to(ROOT)),'before_sha256':sha,'after_sha256':hashlib.sha256(new.encode()).hexdigest(),'backup':str(backup.relative_to(ROOT)),'replacements':[{'old':a,'new':b} for a,b in pairs]})
 print(p.relative_to(ROOT))
p=next((ROOT/'docs/prompts').glob('*角色设定表出图逻辑*.md'))
edit(p,[
 ('# 道劫·角色设定表出图逻辑(2026-09-19 收编定稿)','# 道劫·角色设定表：当前入口与 09-19 至 09-20 实验记录'),
 ('> 本文=「角色设定表」章的成文真源(速查卡 [66] 摘要版见 K2-文生图-道劫.json);数值单源=`daojie_bases.json`(v3)+`daojie_lora_stack.json`(14 槽预设,含「设定板」档),两处热改即时生效,本文是只读投影。','> 当前接线、启停和采样参数以仓库工作流 JSON 为准；底座与 LoRA 预设以 `daojie_bases.json`、`daojie_lora_stack.json` 为准。本文保留多轮实验，不能把不同版本的节点状态合并使用。'),
 ('## 一、两步链总览','''## 当前使用入口（2026-09-21 静态核对）

1. 在应用托管 ComfyUI 画布中打开 `K2-角色设定-道劫.json`；需逐件调 LoRA 时打开同目录 `K2-角色设定-道劫-专家模式.json`。两者真源位于仓库 `apps/backend/engines/comfyui/workflows/` 的图片域，修改参数时保存用户副本。
2. 给参考图节点 `[72]` 选择角色立绘，核对当前激活的提示词、采样器与 SaveImage 上游连线。先确认哪条分支参与执行，再调整种子、画幅和标注；保留的旁路节点并不代表它们会同时运行。
3. 本次读取时两份图均以 `[308]` 的 QuadView 提示词进入 `[119]`，`[164]` 使用 QuadView LoRA，VLM 三件 `[184]/[162]/[163]` 均为 `mode=4`。主文件保留四路分支，但其采样器 `[408–411]` 此次为旁路；`[307]` 标注节点此次也为旁路。早期“VLM 已激活/勿 mute”“四路拼版”“标注必执行”均不能直接当作当前操作要求。
4. 这两份图仍在迭代，节点数、seed、分辨率与启停以打开时的 JSON 为准。本次只做接线与数据核对，未执行出图，未复验下文耗时、画质、同脸或文字效果。

主文件的 LoRA 栈预设和手动开关需要一起看：`设定板` 预设中的 turbo 默认值，与工作流保存的 turbo 开关可不同；不能仅凭预设表断言当前有效组。人物配方已在 09-20 加入金雾，历史五件组不代表所有现行入口。

## 历史实验记录的读法

下文一至八节保留原实验参数、图片证据、评分和诊断：早期 Dynamic 七区/VLM 链、后续 QuadView 单次四视图、程序标注及四路探索属于不同阶段。“终态”仅指当次实验收口；恢复某版时应对照该次 payload/台账完整复现，不能只复制一段旧拨盘。下文 VLM 激活要求仅适用于原七区链。

## 一、历史两步链总览'''),
 ('### 提示词臂','### 历史提示词臂（Dynamic 七区/VLM 版）'),
 ('## 六、常见翻车与缓解','## 六、历史故障与当版缓解'),
 ('- VLM 停用姿势错误(mute 三件)=布局模板丢失:按 §三 摘线回退,勿 mute。','- 原七区 VLM 版中，直接停用三件会丢布局模板，须按该版 §三 改线；当前 QuadView 提示词直连版不适用这条禁令。'),
 ('## 八、实弹验收(09-20 执行;AI 初评待用户终审)','## 八、历史实弹验收(09-20 执行;AI 初评与当时边界)'),
])
p=next((ROOT/'docs/prompts').glob('*九型配方_0919.md'))
edit(p,[
 ('> **状态:v0.2 待用户终审刷新**——本文全部配方数值以 09-19 水墨四件对拍初评定谳为依据(AI 初评,终审权在用户);数值单源=`daojie_bases.json`(v3)与 `daojie_lora_stack.json`(槽位预设),两处热改即时生效,本文是只读投影,以 json 为准。','> **版本边界（2026-09-21 核对）**：本文以 09-19 v0.2 初评为底稿，第一节已吸收后续 09-20 裁定；第二、三、五、六节保留当时试验范围及待审记录。现行数值以 `daojie_bases.json` 与 `daojie_lora_stack.json` 为单源，工作流手动开关另行生效；本次仅核对数据与文档，未重新出图或代替用户审美终审。'),
 ('## 一、九型配方矩阵(默认点亮组;全局件恒挂不入表)','## 一、九型配方矩阵（预设默认组；实际启停以工作流为准）'),
 ('全局常开:turbo 加速×1.0 + 服从度 ProjectorScale×0.01(九型全开,栈数据面 turbo/projector 两槽)。步数档:速度 4 步(turbo 开)/质量 12 步(turbo 急停)。种子口径:配方验证一律 seed=42。','数据面九型预设包含 turbo×1.0 与 ProjectorScale×0.01；turbo 启停由用户手动控制，预设只提供初值。`steps_hint` 为速度 4 步、质量 12 步，采样时还要核对实际 cfg、采样器及 turbo 开关。下文 seed=42 是原配方对拍的种子口径，不是所有工作流的固定默认值。'),
 ('**1536×512 直填**(09-20 A案终审;21:9 大画幅「多个重复」二连否,override 根修)','**`resolution_override` 直填**（09-21 数据面为 3072×1024；09-20 的 1536×512 是较早对拍值）'),
 ('## 二、画风槽四件可用区间(定谳全量,备选与禁线)','## 二、09-19 历史对拍区间（后续裁定见第一节）\n\n以下“人物免开/人物禁同开”是 09-19 初评结论，已被 09-20 人物金雾×0.8 + 鎏金×0.3 的裁定更新；不能再据此关闭现行人物、高清人脸或分镜剧情图预设。其余区间保留为当时实验记录，未逐档重测。'),
 ('## 三、i2i 辅路表(两新实装+既有复用)','## 三、09-19 i2i 辅路记录（入口保留，旧参数不作当前默认）'),
 ('## 五、实弹验收(已执行,图只产不评终审)','## 五、09-19 历史实弹验收（本轮未复跑）'),
 ('## 六、待用户终审清单','## 六、09-19 原待审清单（历史保留）\n\n以下是当时提交的审阅问题；其中画风默认组已有第一节所列后续裁定，不再整体视为当前待办。未在正文记录裁定的项目仍不作已通过声明。'),
])
(TASK/'research/final-prompt-edits.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
