---
name: qwen-image-prompt
description: Qwen-Image 全家桶提示词统一技能——文生图/图生图/多图拼合/画内文字渲染/透明图/姿势控制/道劫专线一入口。Use whenever the user wants to generate or edit images with Qwen-Image / Qwen-Image-2.1 / Qwen-Image-Edit, optimize or rewrite prompts for Qwen ("帮我优化通义生图提示词", "用千问2.1出图", "Qwen改图"), needs readable text rendered inside an image (posters, signs, UI mockups), wants to combine several reference images into one, asks about aspect ratios/styles/camera settings for Qwen, wants 3D-mannequin pose control, or is only choosing an image model for a text-heavy graphic. 合并注(2026-11-08):本技能由 qwen-image-prompt-en + qwen-image-2-1-prompter 合并而成,并收编姿势控制子技能 qwen21-nsfw-pose-skill 与道劫两子技能(daojie-image-prompter / daojie-charsheet-prompter);旧技能名一律按本文件路由表分流。
---

# Qwen-Image Prompt Hub(统一入口)

Qwen-Image-2.1(released 2026-09-20)是 7B 统一模型:文生图、图像编辑、多参考拼合、透明(RGBA)输出、最强画内文字渲染,原生 2K。提示词用**流畅自然语言**,不是 Stable Diffusion 式标签堆。

> **合并注(2026-11-08)**:本技能 = `qwen-image-prompt-en`(MIT,kjranyone/qwen-image-2.1-prompt-guide,官方 PE 口径全景指南+故障模式表)+ `qwen-image-2-1-prompter`(Apache-2.0,iamyoki/qwen-image-2.1-skill,官方 PE 宪法工程化封装)合并,同日收编 `qwen21-nsfw-pose-skill`(Arekejoker,姿势控制产线)与道劫两子技能。凡旧文档/旧对话提到这两个旧技能名,均路由到本文件。

> **Daojie custom-chain override (2026-10-16,继承)**:道劫链上 new asset / local edit / style transfer 须显式三选;local edits 只写操作与保留项;style transfer 加目标绘画语言;来源磨损/血迹/肢体状态/场景光优先;长度随复杂度,不按 PE 配方凑长;验证只用 viggle 9-step 两段式。官方 PE 长度配方不强加最低长度。

---

## 意图路由总表(先查此表再动笔)

| 用户要什么 | 读什么 | 备注 |
|---|---|---|
| 文字生成新图(T2I) | `references/text-to-image.md`(全景)+ `references/t2i_rules.md`(官方八步法) | 两件互补:前者讲原理,后者讲逐句工序 |
| 改图/换风格/多图拼合(Edit) | `references/image-editing.md` + `references/edit_rules.md` | 双语言决策/属性解缠/画幅互斥见下文 Mode 2 |
| 画内文字(海报/招牌/UI/图表) | `references/text-rendering.md` | 叠加在 T2I 或 Edit 规则之上 |
| 透明 PNG/贴纸/抠主体 | `references/capabilities.md` → Transparent images | |
| 画幅/负面提示词/CFG/seed/步数/运行方式 | `references/capabilities.md` | |
| 已验证可用的成品提示词 | `references/examples.md` + `references/cheat_sheet.md` | |
| **姿势控制/摆姿/姿势迁移/3D人偶** | 子技能 `qwen21-nsfw-pose-skill/SKILL.md` | 见下文「姿势控制专线」 |
| **道劫十型主体句/i2i 指令** | 子技能 `daojie-image-prompter/SKILL.md`(符号链→app 资产真源) | 道劫产线专用,画风词禁入主体句 |
| **角色设定板/三视图/灵兽角色卡** | 子技能 `daojie-charsheet-prompter/SKILL.md` | 与十型互为配套不互替:型层管排版,十型管主体句 |
| **Qwen 技能生态全景/上游候选/还有没有别的技能** | `docs/prompts/Qwen-Image-2.1/03-技能全景与逐个分析.md` | 09-23 全网普查 30 件+1108 复查:合格件已全数在本技能内;其余 pointer-only(无许可/AGPL/云端 API 向)只指路不装 |

**道劫不抢答协议**:用户明确说「道劫」或逐型点名(人物海报/场景/道具/美宣/多视图/高清人脸/分镜剧情图/表情差分/概念气氛图/设定卡)→ 走道劫子技能;通用 Qwen 出图(非道劫底座)→ 走本文件通用线。

---

## 核心规则(两源合并,恒适用)

1. **自然句,永不堆标签**。Qwen 系无视 SD 式 tags 与 `(term:1.5)` 权重语法;强调靠描述:"with vibrant, striking red hair"。
2. **语言决策**:直接提示词跟随用户语言(中文可用);复现**官方 PE-T2I 配方**时描述性散文用英文;道劫自定义链按用户语言。画内必须出现的文字保持原文字符,放进双引号逐字抄写("GRAND OPENING"),大小写与标点原样复现。
3. **主体前置**。transformer 重前文、重具体词——主体最先,再环境/风格/构图/光。
4. **编辑=操作+保留句**。"Change X to Y. Keep everything else unchanged." 一轮一个逻辑编辑,大改链式多轮。
5. **画幅走参数不走正文**(`wh_ratio` / `size` / UI 比例选择器),正文永不写 "16:9" 或 "4K"。语义选幅:竖版人像→2:3,演示→16:9,徽章→1:1;默认 3:2 横 / 2:3 竖。
6. **禁质量空话**。"masterpiece"/"8K"/"highly detailed"/"award-winning" 官方劝退——改写成可见内容。
7. **角色设定**:你是**观察者**,描述成品画面;不与用户对话、不给 AI 下指令。

## Mode 1: Text-to-Image(T2I)

- **触发**:无参考图,凭文字生成新图。
- **参考**:`references/text-to-image.md` + `references/t2i_rules.md`(官方八步框架)+ `references/cheat_sheet.md`(词汇表)。
- **官方 PE-T2I 配方结构**(仅复现官方配方时):一段长文(约 20 句、400–500 英文词),20 词锚句开头,8–14 个方位短语走位,光一句,收尾整体构图总结。多元素/精确定位/多文字块必须升长文形态——短提示词在排版与海报上欠佳。
- **极简模板**(简单场景够用):
  ```text
  A neon shop sign that reads "QWEN IMAGE 2.1", rainy night, reflections on wet pavement
  ```

## Mode 2: Image Edit & Multi-Image Compositing(Edit)

- **触发**:用户提供一或多张图(`<image1>`…)要求改/换风格/替换/添加/外扩/拼合。
- **参考**:`references/image-editing.md` + `references/edit_rules.md`。
- **双轨视觉指引**:环境支持看图→先读输入图(可读文字/主体姿势/服装/背景布局)再改写;纯文本→锚定用户给定细节,仅关键不变量(画布身份)不可推时才追问。
- **Golden Rules**:
  1. **双语言决策**:散文语言=用户指令语言(中文指令→中文散文);画内文字=严格优先级(用户给定 > 图内主导文字 > 用户指令语言),单语种。
  2. **属性解缠**:只对点名属性满强度编辑;未点名内容用整句保留条款兜住,不做描述性重绘。
  3. **标签(N≥2 必用)**:`<image1>`/`<image2>` 标注;N=1 只说「图像/the image」不加标签。
  4. **画幅互斥**:`wh_ratio` 有值则 `ratio_follow=""`;`ratio_follow="<imageX>"` 则 `wh_ratio=""`。
- **极简模板**:
  ```text
  Change the background to a sunset beach. Keep the subject, pose, and lighting unchanged.
  ```

## 姿势控制专线(子技能 qwen21-nsfw-pose-skill)

用户要「换姿势/摆姿/姿势迁移/人偶控姿/指定姿势出图」→ 读 `qwen21-nsfw-pose-skill/SKILL.md`(四条路线:T2I 配方 / Edit 保身份换姿势 / 脚本姿势迁移 / VNCCS PoseStudio 浏览器精确控姿;含 136 姿势库与骨骼 JSON 机制)。

**铁律(与道劫 PoseSwap 产线同原理互为佐证)**:姿势参考**必须用无身份特征的 3D 人偶渲染图,禁用照片/插画**作姿势参考。
**参数口径注**:该仓库配方(er_sde+beta / CFG 2.5 / 50 步 / 1152×1728 / NSFW LoRA 恒开)= 作者配方,非本仓产线口径;本仓产线参数以 `docs/comfyui-kb/参数速查.md` 为准。
**合规边界**:该子技能含成人内容生成组件,使用须遵守所在地区法律法规与平台政策;道劫漫画产线只取其姿势控制方法学。

## 道劫专线(两子技能)

- `daojie-image-prompter/SKILL.md` = 符号链 → `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md`(真源,外部 AI 工具亦按此指路,勿建第二真源)。手册内「手册家 `json/...`」的基座=`apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/`(qi21_bases.json=型层/负面/色词典机读真源,prompt_layering.json=分层契约;例句库=docs/prompts/道劫_类型主体句示例.md)。
- `daojie-charsheet-prompter/SKILL.md` = 角色设定板 v5.4(双模板×三视觉模式×角色 DNA 锁定;最终只输出中文提示词正文)。
- 两者互为配套:型层管排版语言,十型管主体句与专项写法,可叠加不互替。

---

## 输出格式(自适应)

### 1. 默认模式(交互友好)
三段式,不出 JSON:
1. **💡 提示词优化解析**:关键决策摘要(主体概念/画幅(`wh_ratio` 或 `ratio_follow`)/光/构图/材质)。
2. **📋 提示词(可直接复制)**:标题 `#### 📋 提示词(可直接复制)`,干净纯文本代码块,只含最终提示词串(画幅已在解析段说明,正文不重复比例标签)。
3. **🎨 进阶微调建议**:2–3 条(风格变体/自定义画内文字/备选画幅)。

### 2. API / 管线模式(严格 JSON)
用户明说 "API 格式"/"JSON only"/"脚本格式" 或在自动化管线中 → **只输出**单行 JSON,无围栏无解释无问候:
```json
{"rewritten_prompt": "...", "wh_ratio": "3:2"}
```
(edit 任务:`{"rewritten_prompt": "...", "wh_ratio": "", "ratio_follow": "<image1>"}`)

## 工具与脚本策略

- **普通交互请求禁跑校验脚本**:`scripts/validate_prompt.py` 仅供开发者离线测试/回归/CI;日常提示词生成与编辑**绝不**执行终端命令或 python 校验,全部在脑内推理后直接交付。
- 仅用户明确要求「跑测试/用 python 脚本校验」时才执行。

## 失败排查

用户报告翻车(文字乱码/主体错/脸漂移)→ 先查 `references/capabilities.md` 故障模式表再改写;姿势类翻车 → 查姿势控制专线各路线的 Known limits。
